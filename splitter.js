/****************************************************************************
 * splitter.js
 * openacousticdevices.info
 * February 2021
 *****************************************************************************/

'use strict';

const fs = require('fs');
const path = require('path');

const wavHandler = require('./wavHandler.js');
const guanoHandler = require('./guanoHandler.js');

/* Debug constant */

const DEBUG = false;

/* File buffer constants */

const NUMBER_OF_BYTES_IN_SAMPLE = 2;

const FILE_BUFFER_SIZE = 32 * 1024;

const FILENAME_REGEX = /^(\d{8}_)?\d{6}\.WAV$/;

/* Time constants */

const SECONDS_IN_DAY = 24 * 60 * 60;

const MILLISECONDS_IN_SECONDS = 1000;

const DATE_REGEX = /Recorded at (\d\d):(\d\d):(\d\d) (\d\d)\/(\d\d)\/(\d{4})/;

const TIMESTAMP_REGEX = /\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d/;

/* Buffers for reading data */

const fileBuffer = Buffer.alloc(FILE_BUFFER_SIZE);

const headerBuffer = Buffer.alloc(FILE_BUFFER_SIZE);

/* Date functions */

function digits (value, number) {

    const string = '00000' + value;

    return string.substring(string.length - number, string.length);

}

function formatFilename (timestamp) {

    const date = new Date(timestamp);

    let filename = date.getUTCFullYear() + digits(date.getUTCMonth() + 1, 2) + digits(date.getUTCDate(), 2) + '_' + digits(date.getUTCHours(), 2) + digits(date.getUTCMinutes(), 2) + digits(date.getUTCSeconds(), 2);

    filename += '.WAV';

    return filename;

}

function formatTimestamp (timestamp) {

    const date = new Date(timestamp);

    const string = date.getUTCFullYear() + '-' + digits(date.getUTCMonth() + 1, 2) + '-' + digits(date.getUTCDate(), 2) + 'T' + digits(date.getUTCHours(), 2) + ':' + digits(date.getUTCMinutes(), 2) + ':' + digits(date.getUTCSeconds(), 2);

    return string;

}

/* Write the output file */

function writeOutputFile (fi, outputPath, header, guano, comment, contents, offset, length, callback) {

    if (DEBUG) {

        console.log('Path: ' + outputPath);

        console.log('Comment: ' + comment);

        console.log('Contents: ' + contents);

        console.log('Offset: ' + offset);

        console.log('Length: ' + length);

        console.log('Duration: ' + Math.round(length / header.wavFormat.samplesPerSecond / NUMBER_OF_BYTES_IN_SAMPLE * MILLISECONDS_IN_SECONDS));

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

    let index = offset;

    while (index < offset + length) {

        /* Determine the number of bytes to write */

        const numberOfBytes = Math.min(FILE_BUFFER_SIZE, offset + length - index);

        /* Read from input file, and then write file buffer */

        fs.readSync(fi, fileBuffer, 0, numberOfBytes, header.size + index);

        fs.writeSync(fo, fileBuffer, 0, numberOfBytes, null);

        /* Increment bytes written and move to next file summary component if appropriate */

        index += numberOfBytes;

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

/* Split a WAV file */

function split (inputPath, outputPath, prefix, maximumFileDuration, callback) {

    /* Check parameter */

    prefix = prefix || '';

    maximumFileDuration = maximumFileDuration || SECONDS_IN_DAY;

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

    if (headerCheck.success === false) {

        return {
            success: false,
            error: headerCheck.error
        };

    }

    const header = headerCheck.header;

    /* Check the header comment format */

    if (header.icmt.comment.search(DATE_REGEX) !== 0) {

        return {
            success: false,
            error: 'Cannot find recording start time in the header comment.'
        };

    }

    /* Determine settings from the input file */

    const inputFileDataSize = header.data.size;

    /* Determine timestamp of input file */

    const regex = DATE_REGEX.exec(header.icmt.comment);

    const originalTimestamp = Date.UTC(regex[6], regex[5] - 1, regex[4], regex[1], regex[2], regex[3]);

    /* Make the initial empty output file list */

    const outputFileList = [];

    /* Main loop generating files */

    let numberOfBytesProcessed = 0;

    let timestamp = originalTimestamp;

    while (numberOfBytesProcessed < inputFileDataSize) {

        /* Determine the number of bytes to write */

        const numberOfBytes = Math.min(maximumFileDuration * header.wavFormat.samplesPerSecond * NUMBER_OF_BYTES_IN_SAMPLE, inputFileDataSize - numberOfBytesProcessed);

        /* Add the output file if appropriate */

        outputFileList.push({
            timestamp: timestamp,
            offset: numberOfBytesProcessed,
            length: numberOfBytes
        });

        timestamp += maximumFileDuration * MILLISECONDS_IN_SECONDS;

        numberOfBytesProcessed += numberOfBytes;

    }

    /* Show the pruned output */

    for (let i = 0; i < outputFileList.length; i += 1) {

        if (DEBUG) console.log(outputFileList[i]);

    }

    /* Read the GUANO if present */

    let guano, contents;

    if (header.data.size + header.size < fileSize) {

        const numberOfBytes = Math.min(fileSize - header.size - header.data.size, FILE_BUFFER_SIZE);

        try {

            /* Read end of file into the buffer */

            const numberOfBytesRead = fs.readSync(fi, fileBuffer, 0, numberOfBytes, header.data.size + header.size);

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

    let progress = 0;

    try {

        if (outputFileList.length === 1 && outputFileList[0].offset === 0 && outputFileList[0].length === inputFileDataSize) {

            const filename = (prefix === '' ? '' : prefix + '_') + formatFilename(originalTimestamp);

            const outputCallback = function(value) {

                const nextProgress = Math.round(100 * value);

                if (nextProgress > progress) {

                    progress = nextProgress;
    
                    if (callback) callback(progress);
    
                }
    
            };

            writeOutputFile(fi, path.join(outputPath, filename), header, guano, null, null, 0, inputFileDataSize, outputCallback);

        } else {

            for (let i = 0; i < outputFileList.length; i += 1) {

                if (callback && i > 0) callback(Math.round(i / outputFileList.length * 100));

                const comment = 'Split from ' + path.basename(inputPath) + ' as file ' + (i + 1) + ' of ' + outputFileList.length + '.';

                const filename = (prefix === '' ? '' : prefix + '_') + formatFilename(outputFileList[i].timestamp);

                const newContents = contents ? contents.replace(TIMESTAMP_REGEX, formatTimestamp(outputFileList[i].timestamp)) : null;

                const outputCallback = function(value) {

                    const nextProgress = Math.round(100 * (i + value) / outputFileList.length);
    
                    if (nextProgress > progress) {
    
                        progress = nextProgress;
        
                        if (callback) callback(progress);
        
                    }
        
                };

                writeOutputFile(fi, path.join(outputPath, filename), header, guano, comment, newContents, outputFileList[i].offset, outputFileList[i].length, outputCallback);

            }

        }

    } catch (e) {

        console.log(e);

        return {
            success: false,
            error: 'Error occurred while splitting files. ' + e
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

/* Export split */

exports.split = split;
