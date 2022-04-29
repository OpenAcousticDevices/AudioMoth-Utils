/****************************************************************************
 * expander.js
 * openacousticdevices.info
 * February 2021
 *****************************************************************************/

'use strict';

const fs = require('fs');
const path = require('path');

const wavHeader = require('./wavHeader.js');

/* Debug constant */

const DEBUG = false;

/* Expansion constants */

const AUDIOMOTH_SEGMENT_SIZE = 32 * 1024;

const ENCODED_BLOCK_SIZE_IN_BYTES = 512;

const NUMBER_OF_BYTES_IN_SAMPLE = 2;

const FILE_BUFFER_SIZE = 32 * 1024;

const UINT32_SIZE_IN_BITS = 32;

const FILENAME_REGEX = /^(\d\d\d\d\d\d\d\d_)?\d\d\d\d\d\dT.WAV$/;

/* Time constants */

const SECONDS_IN_DAY = 24 * 60 * 60;

const MILLISECONDS_IN_SECONDS = 1000;

const DATE_REGEX = /^Recorded at (\d\d):(\d\d):(\d\d) (\d\d)\/(\d\d)\/(\d\d\d\d)/;

/* Buffers for reading data */

const fileBuffer = Buffer.alloc(FILE_BUFFER_SIZE);

const blankBuffer = Buffer.alloc(FILE_BUFFER_SIZE);

const headerBuffer = Buffer.alloc(FILE_BUFFER_SIZE);

/* Check for silent buffer */

function isFullOfZeros (buffer, length) {

    var i, value;

    for (i = 0; i < length / NUMBER_OF_BYTES_IN_SAMPLE; i += 1) {

        value = buffer.readInt16LE(NUMBER_OF_BYTES_IN_SAMPLE * i);

        if (value !== 0) return false;

    }

    return true;

}

/* Decode the encoded block */

function readEncodedBlock (buffer) {

    var i, value, numberOfBlocks;

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

    var string = '00000' + value;

    return string.substr(string.length - number);

}

function formatFilename (timestamp, milliseconds) {

    var date, filename;

    date = new Date(timestamp);

    filename = date.getUTCFullYear() + digits(date.getUTCMonth() + 1, 2) + digits(date.getUTCDate(), 2) + '_' + digits(date.getUTCHours(), 2) + digits(date.getUTCMinutes(), 2) + digits(date.getUTCSeconds(), 2);

    if (milliseconds) filename += '_' + digits(date.getUTCMilliseconds(), 3);

    filename += '.WAV';

    return filename;

}

/* Write the output file */

function writeOutputFile (fi, fileSummary, outputPath, header, comment, offset, length, callback) {

    if (DEBUG) {

        console.log('Path: ' + outputPath);

        console.log('Comment: ' + comment);

        console.log('Offset: ' + offset);

        console.log('Length: ' + length);

        console.log('Duration: ' + Math.round(length / header.wavFormat.samplesPerSecond / NUMBER_OF_BYTES_IN_SAMPLE * MILLISECONDS_IN_SECONDS));

    }

    var i, fo, index, numberOfBytes;

    fo = fs.openSync(outputPath, 'w');

    /* Write the header */

    wavHeader.updateDataSize(header, length);

    wavHeader.updateComment(header, comment);

    wavHeader.writeHeader(headerBuffer, header);

    fs.writeSync(fo, headerBuffer, 0, header.size, null);

    /* Write the data */

    i = 0;

    index = offset;

    while (i < fileSummary.length && index < offset + length) {

        /* Skip forward through file summary components */

        if (fileSummary[i].outputOffset + fileSummary[i].outputBytes - 1 < index) {

            i += 1;

            continue;

        }

        /* Determine the number of bytes to write */

        numberOfBytes = Math.min(FILE_BUFFER_SIZE, fileSummary[i].outputOffset + fileSummary[i].outputBytes - index);

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

    /* Close the output file */

    fs.closeSync(fo);

}

/* Expand a T.WAV file */

function expand (inputPath, outputPath, prefix, expansionType, maximumFileDuration, generateSilentFiles, alignToSecondTransitions, callback) {

    var i, j, fi, type, firstSegment, lastSegment, inputBytes, outputBytes, fileSize, header, headerCheck, progress, nextProgress, outputCallback, inputFileDataSize, regex, filename, comment, hasAudio, numberOfBlocks, fileSummary, timestamp, originalTimestamp, outputFileList, timeOffset, numberOfBytes, numberOfBytesRead, numberOfBytesProcessed, inputFileBytesRead, totalInputBytes, totalOutputBytes;

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

    /* Check the input filename */

    if (FILENAME_REGEX.test(path.parse(inputPath).base) === false) {

        return {
            success: false,
            error: 'File name is incorrect.'
        };

    }

    /* Open input file */

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

    headerCheck = wavHeader.readHeader(headerBuffer, fileSize);

    if (headerCheck.success === false) {

        return {
            success: false,
            error: headerCheck.error
        };

    }

    header = headerCheck.header;

    /* Check the header comment format */

    if (DATE_REGEX.test(header.icmt.comment) === false) {

        return {
            success: false,
            error: 'Cannot find recording start time in the header comment.'
        };

    }

    /* Determine settings from the input file */

    inputFileDataSize = header.data.size;

    /* Read the input file to generate summary data */

    progress = 0;

    fileSummary = [];

    inputFileBytesRead = 0;

    try {

        /* Read first bytes to ensure 512-byte alignment with start of encoded blocks */

        if (header.size % ENCODED_BLOCK_SIZE_IN_BYTES !== 0) {

            numberOfBytes = Math.min(inputFileDataSize, ENCODED_BLOCK_SIZE_IN_BYTES - header.size % ENCODED_BLOCK_SIZE_IN_BYTES);

            numberOfBytesRead = fs.readSync(fi, fileBuffer, 0, numberOfBytes, header.size);

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

            firstSegment = inputFileBytesRead + header.size < AUDIOMOTH_SEGMENT_SIZE;

            lastSegment = inputFileDataSize - inputFileBytesRead < AUDIOMOTH_SEGMENT_SIZE;

            /* Read in at least the encoded block size */

            numberOfBytes = Math.min(inputFileDataSize - inputFileBytesRead, ENCODED_BLOCK_SIZE_IN_BYTES);

            numberOfBytesRead = fs.readSync(fi, fileBuffer, 0, numberOfBytes, inputFileBytesRead + header.size);

            if (numberOfBytesRead !== numberOfBytes) throw new Error('Could not read expected number of bytes.');

            inputFileBytesRead += numberOfBytes;

            /* Update the details of the next file summary element */

            if (numberOfBytes < ENCODED_BLOCK_SIZE_IN_BYTES) {

                /* If bytes read is less than encode block size it may be silent or audio data */

                type = (firstSegment || lastSegment) && isFullOfZeros(fileBuffer, numberOfBytes) ? 'SILENT' : 'AUDIO';
                inputBytes = numberOfBytes;
                outputBytes = numberOfBytes;

            } else {

                /* Check if the encoded block encodes a silent period */

                numberOfBlocks = readEncodedBlock(fileBuffer);

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

            nextProgress = Math.round(50 * inputFileBytesRead / inputFileDataSize);

            if (nextProgress != progress) {

                progress = nextProgress;

                if (callback) callback(progress);

            }

        }

    } catch (e) {

        return {
            success: false,
            error: 'Error occurred while processing input file. ' + e
        };

    }

    /* Count the total output bytes */

    i = 0;

    totalInputBytes = 0;

    totalOutputBytes = 0;

    while (i < fileSummary.length) {

        fileSummary[i].inputOffset = totalInputBytes;

        fileSummary[i].outputOffset = totalOutputBytes;

        totalInputBytes += fileSummary[i].inputBytes;

        totalOutputBytes += fileSummary[i].outputBytes;

        i += 1;

    }

    /* Show the pruned output */

    i = 0;

    while (i < fileSummary.length) {

        if (DEBUG) console.log(fileSummary[i]);

        i += 1;

    }

    /* Determine timestamp of input file */

    regex = DATE_REGEX.exec(header.icmt.comment);

    originalTimestamp = Date.UTC(regex[6], regex[5] - 1, regex[4], regex[1], regex[2], regex[3]);

    /* Make the initial empty output file list */

    outputFileList = [];

    /* Generate the output files */

    if (expansionType === 'DURATION') {

        /* Main loop generating files */

        numberOfBytesProcessed = 0;

        timestamp = originalTimestamp;

        while (numberOfBytesProcessed < totalOutputBytes) {

            /* Determine the number of bytes to write */

            numberOfBytes = Math.min(maximumFileDuration * header.wavFormat.samplesPerSecond * NUMBER_OF_BYTES_IN_SAMPLE, totalOutputBytes - numberOfBytesProcessed);

            /* Check if the file has audio content */

            i = 0;

            hasAudio = false;

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

            timestamp += maximumFileDuration * MILLISECONDS_IN_SECONDS;

            numberOfBytesProcessed += numberOfBytes;

        }

    }

    if (expansionType === 'EVENT') {

        /* Main loop generating files */

        i = 0;

        numberOfBytesProcessed = 0;

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

                j = i;

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

            numberOfBytes = Math.min(maximumFileDuration * header.wavFormat.samplesPerSecond * NUMBER_OF_BYTES_IN_SAMPLE, fileSummary[i].outputOffset + fileSummary[i].outputBytes - numberOfBytesProcessed);

            /* Determine time offset */

            timeOffset = Math.round(numberOfBytesProcessed / header.wavFormat.samplesPerSecond / NUMBER_OF_BYTES_IN_SAMPLE * MILLISECONDS_IN_SECONDS);

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

    for (i = 0; i < outputFileList.length; i += 1) {

        if (DEBUG) console.log(outputFileList[i]);

    }

    /* Write the output files */

    try {

        if (outputFileList.length === 1 && outputFileList[0].offset === 0 && outputFileList[0].length === totalOutputBytes) {

            comment = header.icmt.comment;

            filename = (prefix === '' ? '' : prefix + '_') + formatFilename(originalTimestamp, false);

            outputCallback = function(value) {

                nextProgress = 50 + Math.round(50 * value);

                if (nextProgress > progress) {

                    progress = nextProgress;
    
                    if (callback) callback(progress);
    
                }
    
            }

            writeOutputFile(fi, fileSummary, path.join(outputPath, filename), header, comment, 0, totalOutputBytes, outputCallback);

        } else {

            for (i = 0; i < outputFileList.length; i += 1) {

                comment = 'Expanded from ' + path.basename(inputPath) + ' as file ' + (i + 1) + ' of ' + outputFileList.length + '.';

                filename = (prefix === '' ? '' : prefix + '_') + formatFilename(outputFileList[i].timestamp, outputFileList[i].milliseconds);

                outputCallback = function(value) {

                    nextProgress = 50 + Math.round(50 * (i + value) / outputFileList.length);
    
                    if (nextProgress > progress) {
    
                        progress = nextProgress;
        
                        if (callback) callback(progress);
        
                    }
        
                }

                writeOutputFile(fi, fileSummary, path.join(outputPath, filename), header, comment, outputFileList[i].offset, outputFileList[i].length, outputCallback);

            }

        }

    } catch (e) {

        return {
            success: false,
            error: 'Error occurred while processing duration-based output files. ' + e
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

/* Export expand */

exports.expand = expand;
