/****************************************************************************
 * summariser.js
 * openacousticdevices.info
 * October 2023
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

/* Regex constants */

const FILENAME_REGEXES = [/^([0-9a-zA-Z_]+_)?\d\d\d\d\d\d\d\d_\d\d\d\d\d\d(_\d\d\d)?\.WAV$/, 
                          /^(\d\d\d\d\d\d\d\d_)?\d\d\d\d\d\dT\.WAV$/];

const TIMESTAMP_REGEX = /Recorded at (\d\d:\d\d:\d\d(\.\d\d\d)? \d\d\/\d\d\/\d\d\d\d) \(UTC([-|+]\d+)?:?(\d\d)?\)/;

const BATTERY_GREATER_THAN_REGEX = /greater than 4.9V/;

const BATTERY_LESS_THAN_REGEX = /less than 2.5V/;

const BATTERY_REGEX = /(\d\.\d)V/;

const TEMPERATURE_REGEX = /(-?\d+\.\d)C/;

const TRIGGER_REGEX = /T.WAV/;

/* Time constants */

const SECONDS_IN_DAY = 24 * 60 * 60;

const MILLISECONDS_IN_SECONDS = 1000;

/* Buffers for reading data */

const fileBuffer = Buffer.alloc(FILE_BUFFER_SIZE);

const headerBuffer = Buffer.alloc(FILE_BUFFER_SIZE);

/* Summary constants */

const HEADER = 'File Name,Folder,File Size (bytes),Timestamp,Sample Rate (Hz),Triggered,Samples,Duration (s),Temperature (C),Battery Voltage (V),Comment\r\n';

/* Global variables */

let results = [];

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

function digits(value, number) {

    var string = '00000' + value;

    return string.substr(string.length - number);

}

function escapeRegex(input) {

    return input.replaceAll('\\', '\\\\');

}

function escapeString(input) {

    let escapeString = input.replaceAll('"', '""');

    if (escapeString.includes(',') || escapeString.includes('"') || escapeString.includes('\r') || escapeString.includes('\n')) escapeString = '"' + escapeString + '"';

    return escapeString;

}

function addResult(filename, folder, fileSize, timestamp, sampleRate, triggered, samples, duration, temperature, voltage, comment) {

    let line = filename + ',' + escapeString(folder) + ',' + fileSize + ',';

    if (timestamp !== undefined && timestamp !== null) line += timestamp;
    line += ',';
    
    if (sampleRate !== undefined && sampleRate !== null) line += sampleRate;
    line += ',';

    if (triggered !== undefined && triggered !== null) line += triggered ? '1' : '0';
    line += ',';     
    
    if (samples !== undefined && samples !== null) line += samples;
    line += ',';

    if (duration !== undefined && duration !== null) line += duration;
    line += ',';

    if (temperature !== undefined && temperature !== null) line += temperature;
    line += ',';

    if (voltage !== undefined && voltage !== null) line += voltage;
    line += ',';

    if (comment !== undefined && comment !== null) line += escapeString(comment);
    line += '\r\n';

    results.push({
        filename: filename,
        folder: folder,
        line: line 
    });

}

/* Summarise WAV files */

function initialise () {

    results = [];

}

function finalise (outputPath) {

    /* Declare a sort function */

    const sortedResults = results.sort(function(a, b) {
        
        let x = a.folder;
        let y = b.folder;

        if (x>y) return 1; 

        if (x<y) return -1;

        x = a.filename;
        y = b.filename;
 
        if (x>y) return 1; 

        if (x<y) return -1;

        return 0;

    });

    /* Write the output file */

    try {

        /* Check the output path */

        if (fs.lstatSync(outputPath).isDirectory() === false) {

            return {
                success: false,
                error: 'Destination path is not a directory.'
            };

        }

        /* Write the output file */

        const fo = fs.openSync(path.join(outputPath, 'SUMMARY.CSV'), 'w');

        fs.writeSync(fo, HEADER);

        for (let i = 0; i < sortedResults.length; i += 1) {

            fs.writeSync(fo, sortedResults[i].line);

        }

        fs.closeSync(fo);   

    } catch (e) {

        return {
            success: false,
            error: 'Error writing output file.'
        };    

    }

    /* Return success */

    return {
        success: true,
        error: null
    }; 

}

function summarise (folderPath, filePath, callback) {

    var fi, fileSize, samples, progress = 0;

    /* Check the input filename */

    const filename = path.parse(filePath).base;

    let valid = false;

    for (let i = 0; i < FILENAME_REGEXES.length; i += 1) {

        valid = valid || FILENAME_REGEXES[i].test(filename);

    }

    if (valid == false) {

        return false;

    }

    /* Extract folder name */

    const separator = escapeRegex(path.sep);

    let folder = filePath.replace(folderPath, '').replace(filename, '');

    folder = folder.replace(new RegExp('^' + separator), '');

    folder = folder.replace(new RegExp(separator + '$'), '');
    
    /* Open input file and find the file size */

    try {

        fi = fs.openSync(filePath, 'r');

        fileSize = fs.statSync(filePath).size;

    } catch (e) {

        return false;

    }

    if (fileSize === 0) {

        addResult(filename, folder, fileSize);

        return true;

    }

    /* Read the header */

    try {

        fs.readSync(fi, headerBuffer, 0, FILE_BUFFER_SIZE, 0);

    } catch (e) {

        addResult(filename, folder, fileSize);

        return true;

    }

    /* Check the header */

    const headerCheck = wavHeader.readHeader(headerBuffer, fileSize);

    if (headerCheck.success === false) {

        addResult(filename, folder, fileSize);

        return true;

    }

    const header = headerCheck.header;

    /* Determine settings from the input file */

    const inputFileDataSize = header.data.size;

    /* Declare the return values */

    let timestamp = null;
    let sampleRate = null;
    let triggered = null;
    let duration = null;
    let temperature = null;
    let voltage = null;

    const comment = header.icmt.comment;

    /* Check the header comment format */

    if (TIMESTAMP_REGEX.test(comment)) {

        /* Read the timestamp */

        const timestampMatch = comment.match(TIMESTAMP_REGEX);

        const offset = timestampMatch[2] ? 4 : 0;

        timestamp = timestampMatch[1].substr(15 + offset, 4);

        timestamp += '-' + timestampMatch[1].substr(12 + offset, 2);
        timestamp += '-' + timestampMatch[1].substr(9 + offset, 2);
        timestamp += 'T' + timestampMatch[1].substr(0, 8 + offset);

        if (timestampMatch[3]) {

            const hours = parseInt(timestampMatch[3], 10);

            timestamp += hours >= 0 ? '+' : '-';

            timestamp += digits(Math.abs(hours), 2);

            if (timestampMatch[4]) {

                const minutes = parseInt(timestampMatch[4], 10);

                timestamp += ':' + digits(Math.abs(minutes), 2);

            } else {

                timestamp += ':00';
                
            }

        } else {

            timestamp += 'Z';

        }

    }

    /* Read the sample rate */

    sampleRate = header.wavFormat.samplesPerSecond;

    /* Is triggered */

    triggered = TRIGGER_REGEX.test(filename) ? true : false;
    
    /* Count samples */

    if (triggered) {

        /* Read the input file to count samples */

        samples = 0;

        let inputFileBytesRead = 0;

        try {

            /* Read first bytes to ensure 512-byte alignment with start of encoded blocks */

            if (header.size % ENCODED_BLOCK_SIZE_IN_BYTES !== 0) {

                const numberOfBytes = Math.min(inputFileDataSize, ENCODED_BLOCK_SIZE_IN_BYTES - header.size % ENCODED_BLOCK_SIZE_IN_BYTES);

                const numberOfBytesRead = fs.readSync(fi, fileBuffer, 0, numberOfBytes, header.size);

                if (numberOfBytesRead !== numberOfBytes) throw new Error('Could not read expected number of bytes.');

                inputFileBytesRead += numberOfBytes;

                samples += numberOfBytes;

            }

            /* Read each block or segment */

            while (inputFileBytesRead < inputFileDataSize) {

                /* Read in at least the encoded block size */

                const numberOfBytes = Math.min(inputFileDataSize - inputFileBytesRead, ENCODED_BLOCK_SIZE_IN_BYTES);

                const numberOfBytesRead = fs.readSync(fi, fileBuffer, 0, numberOfBytes, inputFileBytesRead + header.size);

                if (numberOfBytesRead !== numberOfBytes) throw new Error('Could not read expected number of bytes.');

                inputFileBytesRead += numberOfBytes;

                /* Update the details of the next file summary element */

                if (numberOfBytes < ENCODED_BLOCK_SIZE_IN_BYTES) {

                    samples += numberOfBytes;

                } else {

                    /* Check if the encoded block encodes a silent period */

                    const numberOfBlocks = readEncodedBlock(fileBuffer);

                    if (numberOfBlocks > 0) {

                        samples += numberOfBlocks * ENCODED_BLOCK_SIZE_IN_BYTES;

                    } else {

                        samples += ENCODED_BLOCK_SIZE_IN_BYTES;

                    }

                }

                /* Update the progress callback */

                const nextProgress = Math.round(99 * inputFileBytesRead / inputFileDataSize);

                if (nextProgress != progress) {

                    progress = nextProgress;

                    if (callback) callback(progress);

                }

            }

            samples /= NUMBER_OF_BYTES_IN_SAMPLE;

        } catch (e) {

            samples = null;

        }

    } else {

        samples = inputFileDataSize / NUMBER_OF_BYTES_IN_SAMPLE;

    }

    /* Calculate duration */

    duration = sampleRate !== undefined && sampleRate !== null ? Math.round(samples / sampleRate * MILLISECONDS_IN_SECONDS) / MILLISECONDS_IN_SECONDS : null;

    /* Determine temperature */

    if (TEMPERATURE_REGEX.test(comment)) {

        temperature = comment.match(TEMPERATURE_REGEX)[1] ? comment.match(TEMPERATURE_REGEX)[1] : null;

    }

    /* Determine battery voltage */

    if (BATTERY_REGEX.test(comment)) {

        voltage = comment.match(BATTERY_GREATER_THAN_REGEX) ? '5.0' : comment.match(BATTERY_LESS_THAN_REGEX) ? '2.4' : comment.match(BATTERY_REGEX)[1] ? comment.match(BATTERY_REGEX)[1] : null;

    }

    /* Add results and return */

    addResult(filename, folder, fileSize, timestamp, sampleRate, triggered, samples, duration, temperature, voltage, comment);

    if (callback && progress < 100) callback(100);

    /* Return success */

    return true;

}

/* Export split */

exports.initialise = initialise;

exports.summarise = summarise;

exports.finalise = finalise;
