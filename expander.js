/****************************************************************************
 * expander.js
 * openacousticdevices.info
 * February 2021
 *****************************************************************************/

'use strict';

const fs = require('fs');
const path = require('path');

const wavHandler = require('./wavHandler.js');
const guanoHandler = require('./guanoHandler.js');
const filenameHandler = require('./filenameHandler.js');

/* Debug constant */

const DEBUG = false;

/* Expansion constants */

const AUDIOMOTH_SEGMENT_SIZE = 32 * 1024;

const ENCODED_BLOCK_SIZE_IN_BYTES = 512;

const NUMBER_OF_BYTES_IN_SAMPLE = 2;

const FILE_BUFFER_SIZE = 32 * 1024;

const HEADER_BUFFER_SIZE = 32 * 1024;

const UINT32_SIZE_IN_BITS = 32;

/* Time constants */

const SECONDS_IN_DAY = 24 * 60 * 60;

const MILLISECONDS_IN_SECOND = 1000;

const TIMESTAMP_REGEX = /\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d/;

/* Buffers for reading data */

const fileBuffer = Buffer.alloc(FILE_BUFFER_SIZE);

const blankBuffer = Buffer.alloc(FILE_BUFFER_SIZE);

const headerBuffer = Buffer.alloc(HEADER_BUFFER_SIZE);

/* Check for silent buffer */

function isFullOfZeros (buffer, length) {

    let i, value;

    for (i = 0; i < length / NUMBER_OF_BYTES_IN_SAMPLE; i += 1) {

        value = buffer.readInt16LE(NUMBER_OF_BYTES_IN_SAMPLE * i);

        if (value !== 0) return false;

    }

    return true;

}

/* Decode the encoded block */

function readEncodedBlock (buffer) {

    let i, value, numberOfBlocks;

    numberOfBlocks = 0;

    for (i = 0; i < UINT32_SIZE_IN_BITS; i += 1) {

        value = buffer.readInt16LE(NUMBER_OF_BYTES_IN_SAMPLE * i);

        if (value === 1) {

            numberOfBlocks += (1 << i);

        } else if (value !== -1) {

            return 0;

        }

    }

    for (i = UINT32_SIZE_IN_BITS; i < ENCODED_BLOCK_SIZE_IN_BYTES / NUMBER_OF_BYTES_IN_SAMPLE; i += 1) {

        value = buffer.readInt16LE(NUMBER_OF_BYTES_IN_SAMPLE * i);

        if (value !== 0) {

            return 0;

        }

    }

    return numberOfBlocks;

}

/* Date functions */

function digits (value, number) {

    const string = '00000' + value;

    return string.substr(string.length - number);

}

function formatFilename (timestamp, milliseconds) {

    let filename;

    const date = new Date(timestamp);

    filename = date.getUTCFullYear() + digits(date.getUTCMonth() + 1, 2) + digits(date.getUTCDate(), 2) + '_' + digits(date.getUTCHours(), 2) + digits(date.getUTCMinutes(), 2) + digits(date.getUTCSeconds(), 2);

    if (milliseconds) filename += '_' + digits(date.getUTCMilliseconds(), 3);

    filename += '.WAV';

    return filename;

}

function formatTimestamp (timestamp, milliseconds) {

    const date = new Date(timestamp);

    let string = date.getUTCFullYear() + '-' + digits(date.getUTCMonth() + 1, 2) + '-' + digits(date.getUTCDate(), 2) + 'T' + digits(date.getUTCHours(), 2) + ':' + digits(date.getUTCMinutes(), 2) + ':' + digits(date.getUTCSeconds(), 2);

    if (milliseconds) string += '.' + digits(date.getUTCMilliseconds(), 3);

    return string;

}

/* Write the output file */

function writeOutputFile (fi, fileSummary, outputPath, header, guano, comment, contents, offset, length, callback) {

    if (DEBUG) {

        console.log('Path: ' + outputPath);

        console.log('Comment: ' + comment);

        console.log('Contents: ' + contents);

        console.log('Offset: ' + offset);

        console.log('Length: ' + length);

        console.log('Duration: ' + Math.round(length / header.wavFormat.samplesPerSecond / NUMBER_OF_BYTES_IN_SAMPLE * MILLISECONDS_IN_SECOND));

    }

    const fo = fs.openSync(outputPath, 'w');

    /* Update WAV header and GUANO */

    if (comment) wavHandler.updateComment(header, comment);

    if (guano && contents) guanoHandler.updateContents(guano, contents);

    wavHandler.updateSizes(header, guano, length);

    /* Write the WAV header */

    wavHandler.writeHeader(headerBuffer, header);

    fs.writeSync(fo, headerBuffer, 0, header.size, null);

    /* Write the data */

    let i = 0;

    let index = offset;

    while (i < fileSummary.length && index < offset + length) {

        /* Skip forward through file summary components */

        if (fileSummary[i].outputOffset + fileSummary[i].outputBytes - 1 < index) {

            i += 1;

            continue;

        }

        /* Determine the number of bytes to write */

        let numberOfBytes = Math.min(FILE_BUFFER_SIZE, fileSummary[i].outputOffset + fileSummary[i].outputBytes - index);

        numberOfBytes = Math.min(numberOfBytes, offset + length - index);

        /* Read from input file, and then write file buffer or blank buffer */

        if (fileSummary[i].type === 'AUDIO') {

            fs.readSync(fi, fileBuffer, 0, numberOfBytes, header.size + index - fileSummary[i].outputOffset + fileSummary[i].inputOffset);

            fs.writeSync(fo, fileBuffer, 0, numberOfBytes, null);

        } else {

            fs.writeSync(fo, blankBuffer, 0, numberOfBytes, null);

        }

        /* Increment bytes written and move to next file summary component if appropriate */

        index += numberOfBytes;

        if (index === fileSummary[i].outputOffset + fileSummary[i].outputBytes) i += 1;

        /* Callback with progress */

        if (callback) callback((index - offset) / length);

    }

    /* Write the GUANO */

    if (guano) {

        guanoHandler.writeGuano(fileBuffer, guano);

        fs.writeSync(fo, fileBuffer, 0, guano.size, null);

    }

    /* Close the output file */

    fs.closeSync(fo);

}

/* Expand a T.WAV file */

function expand (inputPath, outputPath, prefix, expansionType, maximumFileDuration, generateSilentFiles, alignToSecondTransitions, callback) {

    /* Check parameter */

    prefix = prefix || '';

    maximumFileDuration = maximumFileDuration || SECONDS_IN_DAY;

    generateSilentFiles = generateSilentFiles || false;

    alignToSecondTransitions = alignToSecondTransitions || false;

    if (maximumFileDuration !== Math.round(maximumFileDuration)) {

        return {
            success: false,
            error: 'Maximum file duration must be an integer.'
        };

    }

    if (maximumFileDuration <= 0) {

        return {
            success: false,
            error: 'Maximum file duration must be greater than zero.'
        };

    }

    if (expansionType !== 'DURATION' && expansionType !== 'EVENT') {

        return {
            success: false,
            error: 'Expansion type must be DURATION or EVENT.'
        };

    }

    if (typeof generateSilentFiles !== 'boolean') {

        return {
            success: false,
            error: 'Generate silent files flag must be a boolean.'
        };

    }

    if (typeof alignToSecondTransitions !== 'boolean') {

        return {
            success: false,
            error: 'Align to second transitions flag must be a boolean.'
        };

    }

    if (typeof prefix !== 'string') {

        return {
            success: false,
            error: 'Filename prefix must be a string.'
        };

    }

    /* Open input file */

    let fi;

    try {

        fi = fs.openSync(inputPath, 'r');

    } catch (e) {

        return {
            success: false,
            error: 'Could not open input file.'
        };

    }

    /* Check the output path */

    outputPath = outputPath || path.parse(inputPath).dir;

    if (fs.lstatSync(outputPath).isDirectory() === false) {

        return {
            success: false,
            error: 'Destination path is not a directory.'
        };

    }

    /* Find the input file size */

    let fileSize;

    try {

        fileSize = fs.statSync(inputPath).size;

    } catch (e) {

        return {
            success: false,
            error: 'Could not read input file size.'
        };

    }

    if (fileSize === 0) {

        return {
            success: false,
            error: 'Input file has zero size.'
        };

    }

    /* Read the header */

    try {

        fs.readSync(fi, headerBuffer, 0, FILE_BUFFER_SIZE, 0);

    } catch (e) {

        return {
            success: false,
            error: 'Could not read the input WAV header.'
        };

    }

    /* Check the header */

    const headerCheck = wavHandler.readHeader(headerBuffer, fileSize);

    if (headerCheck.success === false) return headerCheck;

    /* Extract header */

    const header = headerCheck.header;

    /* Check the filename against header */

    const inputFilename = path.parse(inputPath).base;

    const filenameCheck = filenameHandler.checkFilenameAgainstHeader(filenameHandler.EXPAND, inputFilename, header.icmt.comment, header.iart.artist);

    if (filenameCheck.success === false) return filenameCheck;

    /* Extract original timestamp and existing prefix */

    const existingPrefix = filenameCheck.existingPrefix;

    const originalTimestamp = filenameCheck.originalTimestamp;

    /* Determine settings from the input file */

    const inputFileDataSize = header.data.size;

    const inputFileHeaderSize = header.size;

    /* Read the input file to generate summary data */

    let progress = 0;

    const fileSummary = [];

    let inputFileBytesRead = 0;

    try {

        /* Read first bytes to ensure 512-byte alignment with start of encoded blocks */

        if (header.size % ENCODED_BLOCK_SIZE_IN_BYTES !== 0) {

            const numberOfBytes = Math.min(inputFileDataSize, ENCODED_BLOCK_SIZE_IN_BYTES - header.size % ENCODED_BLOCK_SIZE_IN_BYTES);

            const numberOfBytesRead = fs.readSync(fi, fileBuffer, 0, numberOfBytes, header.size);

            if (numberOfBytesRead !== numberOfBytes) throw new Error('Could not read expected number of bytes.');

            inputFileBytesRead += numberOfBytes;

            fileSummary.push({
                type: isFullOfZeros(fileBuffer, numberOfBytes) ? 'SILENT' : 'AUDIO',
                inputBytes: numberOfBytes,
                outputBytes: numberOfBytes
            });

        }

        /* Read each block or segment */

        while (inputFileBytesRead < inputFileDataSize) {

            /* Check if this is the first or last segment */

            const firstSegment = inputFileBytesRead + header.size < AUDIOMOTH_SEGMENT_SIZE;

            const lastSegment = inputFileDataSize - inputFileBytesRead < AUDIOMOTH_SEGMENT_SIZE;

            /* Read in at least the encoded block size */

            const numberOfBytes = Math.min(inputFileDataSize - inputFileBytesRead, ENCODED_BLOCK_SIZE_IN_BYTES);

            const numberOfBytesRead = fs.readSync(fi, fileBuffer, 0, numberOfBytes, inputFileBytesRead + header.size);

            if (numberOfBytesRead !== numberOfBytes) throw new Error('Could not read expected number of bytes.');

            inputFileBytesRead += numberOfBytes;

            /* Update the details of the next file summary element */

            let type, inputBytes, outputBytes;

            if (numberOfBytes < ENCODED_BLOCK_SIZE_IN_BYTES) {

                /* If bytes read is less than encode block size it may be silent or audio data */

                type = (firstSegment || lastSegment) && isFullOfZeros(fileBuffer, numberOfBytes) ? 'SILENT' : 'AUDIO';
                inputBytes = numberOfBytes;
                outputBytes = numberOfBytes;

            } else {

                /* Check if the encoded block encodes a silent period */

                const numberOfBlocks = readEncodedBlock(fileBuffer);

                if (numberOfBlocks > 0) {

                    /* Add the silent period */

                    type = 'SILENT';
                    inputBytes = ENCODED_BLOCK_SIZE_IN_BYTES;
                    outputBytes = numberOfBlocks * ENCODED_BLOCK_SIZE_IN_BYTES;

                } else {

                    /* Add audio block */

                    type = (firstSegment || lastSegment) && isFullOfZeros(fileBuffer, ENCODED_BLOCK_SIZE_IN_BYTES) ? 'SILENT' : 'AUDIO';
                    inputBytes = ENCODED_BLOCK_SIZE_IN_BYTES;
                    outputBytes = ENCODED_BLOCK_SIZE_IN_BYTES;

                }

            }

            if (fileSummary.length === 0 || type !== fileSummary[fileSummary.length - 1].type) {

                /* Add new block */

                fileSummary.push({
                    type: type,
                    inputBytes: inputBytes,
                    outputBytes: outputBytes
                });

            } else {

                /* Append to existing block */

                fileSummary[fileSummary.length - 1].inputBytes += inputBytes;
                fileSummary[fileSummary.length - 1].outputBytes += outputBytes;

            }

            /* Update the progress callback */

            const nextProgress = Math.round(50 * inputFileBytesRead / inputFileDataSize);

            if (nextProgress !== progress) {

                progress = nextProgress;

                if (callback) callback(progress);

            }

        }

    } catch (e) {

        return {
            success: false,
            error: 'An error occurred while processing the input file. '
        };

    }

    /* Count the total output bytes */

    let totalInputBytes = 0;

    let totalOutputBytes = 0;

    for (let i = 0; i < fileSummary.length; i += 1) {

        fileSummary[i].inputOffset = totalInputBytes;

        fileSummary[i].outputOffset = totalOutputBytes;

        totalInputBytes += fileSummary[i].inputBytes;

        totalOutputBytes += fileSummary[i].outputBytes;

    }

    /* Show the pruned output */

    for (let i = 0; i < fileSummary.length; i += 1) {

        if (DEBUG) console.log(fileSummary[i]);

    }

    /* Make the initial empty output file list */

    const outputFileList = [];

    /* Generate the output files */

    if (expansionType === 'DURATION') {

        /* Main loop generating files */

        let numberOfBytesProcessed = 0;

        let timestamp = originalTimestamp;

        while (numberOfBytesProcessed < totalOutputBytes) {

            /* Determine the number of bytes to write */

            const numberOfBytes = Math.min(maximumFileDuration * header.wavFormat.samplesPerSecond * NUMBER_OF_BYTES_IN_SAMPLE, totalOutputBytes - numberOfBytesProcessed);

            /* Check if the file has audio content */

            let i = 0;

            let hasAudio = false;

            while (i < fileSummary.length) {

                if (fileSummary[i].type === 'AUDIO' && numberOfBytesProcessed <= fileSummary[i].outputOffset + fileSummary[i].outputBytes - 1 && numberOfBytesProcessed + numberOfBytes - 1 >= fileSummary[i].outputOffset) hasAudio = true;

                i += 1;

            }

            /* Add the output file if appropriate */

            if (hasAudio || generateSilentFiles || maximumFileDuration === SECONDS_IN_DAY) {

                outputFileList.push({
                    timestamp: timestamp,
                    milliseconds: false,
                    offset: numberOfBytesProcessed,
                    length: numberOfBytes
                });

            }

            timestamp += maximumFileDuration * MILLISECONDS_IN_SECOND;

            numberOfBytesProcessed += numberOfBytes;

        }

    }

    if (expansionType === 'EVENT') {

        /* Main loop generating files */

        let i = 0;

        let numberOfBytesProcessed = 0;

        while (i < fileSummary.length && numberOfBytesProcessed < totalOutputBytes) {

            /* Skip if segment is silent */

            if (fileSummary[i].type === 'SILENT') {

                numberOfBytesProcessed = fileSummary[i].outputOffset + fileSummary[i].outputBytes;

                i += 1;

                continue;

            }

            /* Determine which file to write next */

            if (alignToSecondTransitions) {

                /* Roll back the start time to the second transition */

                numberOfBytesProcessed -= numberOfBytesProcessed % (header.wavFormat.samplesPerSecond * NUMBER_OF_BYTES_IN_SAMPLE);

                /* Roll forward to the appropriate segment */

                let j = i;

                while (j < fileSummary.length - 1) {

                    if (fileSummary[j + 1].type === 'AUDIO') {

                        if (fileSummary[j + 1].outputOffset < numberOfBytesProcessed + header.wavFormat.samplesPerSecond * NUMBER_OF_BYTES_IN_SAMPLE) {

                            i = j + 1;

                        } else {

                            break;

                        }

                    }

                    j += 1;

                }

            }

            /* Calculate the number of bytes to write */

            const numberOfBytes = Math.min(maximumFileDuration * header.wavFormat.samplesPerSecond * NUMBER_OF_BYTES_IN_SAMPLE, fileSummary[i].outputOffset + fileSummary[i].outputBytes - numberOfBytesProcessed);

            /* Determine time offset */

            const timeOffset = Math.round(numberOfBytesProcessed / header.wavFormat.samplesPerSecond / NUMBER_OF_BYTES_IN_SAMPLE * MILLISECONDS_IN_SECOND);

            /* Add the output file */

            outputFileList.push({
                timestamp: originalTimestamp + timeOffset,
                milliseconds: alignToSecondTransitions === false,
                offset: numberOfBytesProcessed,
                length: numberOfBytes
            });

            /* Update the bytes processed and file summary counters */

            numberOfBytesProcessed += numberOfBytes;

            if (numberOfBytesProcessed === fileSummary[i].outputOffset + fileSummary[i].outputBytes) i += 1;

        }

    }

    /* Show the pruned output */

    for (let i = 0; i < outputFileList.length; i += 1) {

        if (DEBUG) console.log(outputFileList[i]);

    }

    /* Read the GUANO if present */

    let guano, contents;

    if (inputFileDataSize + inputFileHeaderSize < fileSize) {

        const numberOfBytes = Math.min(fileSize - inputFileHeaderSize - inputFileDataSize, HEADER_BUFFER_SIZE);

        try {

            /* Read end of file into the buffer */

            const numberOfBytesRead = fs.readSync(fi, fileBuffer, 0, numberOfBytes, inputFileDataSize + inputFileHeaderSize);

            if (numberOfBytesRead === numberOfBytes) {

                /* Parse the GUANO header */

                const guanoCheck = guanoHandler.readGuano(fileBuffer, numberOfBytes);

                if (guanoCheck.success) {

                    guano = guanoCheck.guano;

                    contents = guano.contents;

                }

            }

        } catch (e) {

            guano = null;

            contents = null;

        }

    }

    /* Write the output files */

    try {

        if (outputFileList.length === 1 && outputFileList[0].offset === 0 && outputFileList[0].length === totalOutputBytes) {

            const filename = (prefix === '' ? '' : prefix + '_') + existingPrefix + formatFilename(originalTimestamp, false);

            const outputCallback = function (value) {

                const nextProgress = 50 + Math.round(50 * value);

                if (nextProgress > progress) {

                    progress = nextProgress;

                    if (callback) callback(progress);

                }

            };

            writeOutputFile(fi, fileSummary, path.join(outputPath, filename), header, guano, null, null, 0, totalOutputBytes, outputCallback);

        } else {

            for (let i = 0; i < outputFileList.length; i += 1) {

                const comment = 'Expanded from ' + path.basename(inputPath) + ' as file ' + (i + 1) + ' of ' + outputFileList.length + '.';

                const filename = (prefix === '' ? '' : prefix + '_') + existingPrefix + formatFilename(outputFileList[i].timestamp, outputFileList[i].milliseconds);

                const newContents = contents ? contents.replace(TIMESTAMP_REGEX, formatTimestamp(outputFileList[i].timestamp, outputFileList[i].milliseconds)) : null;

                const outputCallback = function (value) {

                    const nextProgress = 50 + Math.round(50 * (i + value) / outputFileList.length);

                    if (nextProgress > progress) {

                        progress = nextProgress;

                        if (callback) callback(progress);

                    }

                };

                writeOutputFile(fi, fileSummary, path.join(outputPath, filename), header, guano, comment, newContents, outputFileList[i].offset, outputFileList[i].length, outputCallback);

            }

        }

    } catch (e) {

        return {
            success: false,
            error: 'An error occurred while processing the duration-based output files. '
        };

    }

    if (callback && progress < 100) callback(100);

    /* Close the input file */

    fs.closeSync(fi);

    /* Return success */

    return {
        success: true,
        error: null
    };

}

/* Exports */

exports.expand = expand;
