/****************************************************************************
 * summariser.js
 * openacousticdevices.info
 * October 2023
 *****************************************************************************/

'use strict';

const fs = require('fs');
const path = require('path');

const wavHandler = require('./wavHandler.js');
const guanoHandler = require('./guanoHandler.js');
const filenameHandler = require('./filenameHandler.js');

/* Expansion constants */

const ENCODED_BLOCK_SIZE_IN_BYTES = 512;

const NUMBER_OF_BYTES_IN_SAMPLE = 2;

const FILE_BUFFER_SIZE = 32 * 1024;

const UINT32_SIZE_IN_BITS = 32;

/* Regex constants */

const VALID_FILENAME_OPERATIONS = [
    filenameHandler.SPLIT,
    filenameHandler.DOWNSAMPLE,
    filenameHandler.EXPAND,
    filenameHandler.SYNC
];

const TIMESTAMP_REGEX = /Recorded at (\d\d:\d\d:\d\d(\.\d{3})? \d\d\/\d\d\/\d{4}) \(UTC([-|+]\d+)?:?(\d\d)?\)/;

const BATTERY_GREATER_THAN_REGEX = /greater than 4.9V/;

const BATTERY_LESS_THAN_REGEX = /less than 2.5V/;

const BATTERY_REGEX = /(\d\.\d)V/;

const TEMPERATURE_REGEX = /(-?\d+\.\d)C/;

const TRIGGER_REGEX = /T.WAV/;

const GUANO_LOCATION_REGEX_2 = /Loc Position:(\-?\d{1,2}\.\d{2}) (\-?\d{1,3}\.\d{2})/;

const GUANO_LOCATION_REGEX_6 = /Loc Position:(\-?\d{1,2}\.\d{6}) (\-?\d{1,3}\.\d{6})/;

const GUANO_TIMESTAMP_REGEX = /Timestamp:(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:(\.\d{3})?)(?:Z|(?:[\+\-]\d\d:\d\d)))/;

const GUANO_TEMPERATURE_REGEX = /Temperature Int:(\-?\d+\.\d)/;

const GUANO_VOLTAGE_REGEX = /OAD\|Battery Voltage:(\d\.\d)/;

/* Time constants */

const MILLISECONDS_IN_SECOND = 1000;

/* Buffers for reading data */

const fileBuffer = Buffer.alloc(FILE_BUFFER_SIZE);

const headerBuffer = Buffer.alloc(FILE_BUFFER_SIZE);

/* Summary constants */

const HEADER = 'File Name,Folder,File Size (bytes),Timestamp,Latitude,Longitude,Sample Rate (Hz),Triggered,Samples,Duration (s),Temperature (C),Battery Voltage (V),Comment\r\n';

/* Global variables */

let results = [];

/* Decode the encoded block */

function readEncodedBlock (buffer) {

    let numberOfBlocks = 0;

    for (let i = 0; i < UINT32_SIZE_IN_BITS; i += 1) {

        const value = buffer.readInt16LE(NUMBER_OF_BYTES_IN_SAMPLE * i);

        if (value === 1) {

            numberOfBlocks += (1 << i);

        } else if (value !== -1) {

            return 0;

        }

    }

    for (let i = UINT32_SIZE_IN_BITS; i < ENCODED_BLOCK_SIZE_IN_BYTES / NUMBER_OF_BYTES_IN_SAMPLE; i += 1) {

        const value = buffer.readInt16LE(NUMBER_OF_BYTES_IN_SAMPLE * i);

        if (value !== 0) {

            return 0;

        }

    }

    return numberOfBlocks;

}

function digits (value, number) {

    const string = '00000' + value;

    return string.substring(string.length - number, string.length);

}

function escapeRegex (input) {

    return input.replaceAll('\\', '\\\\');

}

function escapeString (input) {

    let escapeString = input.replaceAll('"', '""');

    if (escapeString.includes(',') || escapeString.includes('"') || escapeString.includes('\r') || escapeString.includes('\n')) escapeString = '"' + escapeString + '"';

    return escapeString;

}

function addResult (filename, folder, fileSize, timestamp, latitude, longitude, sampleRate, triggered, samples, duration, temperature, voltage, comment) {

    let line = filename + ',' + escapeString(folder) + ',' + fileSize + ',';

    if (timestamp !== undefined && timestamp !== null) line += timestamp;
    line += ',';

    if (latitude !== undefined && latitude !== null) line += latitude;
    line += ',';

    if (longitude !== undefined && longitude !== null) line += longitude;
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

    const sortedResults = results.sort(function (a, b) {

        let x = a.folder;
        let y = b.folder;

        if (x > y) return 1;

        if (x < y) return -1;

        x = a.filename;
        y = b.filename;

        if (x > y) return 1;

        if (x < y) return -1;

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
            error: 'An error occurred while writing the output file.'
        };

    }

    /* Return success */

    return {
        success: true,
        error: null
    };

}

function summarise (folderPath, filePath, callback) {

    /* Check the input filename */

    let valid = false;

    const filename = path.parse(filePath).base;

    for (let i = 0; i < VALID_FILENAME_OPERATIONS.length; i += 1) {

        const regex = filenameHandler.getFilenameRegex(VALID_FILENAME_OPERATIONS[i]);

        valid = valid || regex.test(filename);

    }

    if (valid === false) return false;

    /* Extract folder name */

    const separator = escapeRegex(path.sep);

    let folder = filePath.replace(folderPath, '').replace(filename, '');

    folder = folder.replace(new RegExp('^' + separator), '');

    folder = folder.replace(new RegExp(separator + '$'), '');

    /* Open input file and find the file size */

    let fi, fileSize;

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

    const headerCheck = wavHandler.readHeader(headerBuffer, fileSize);

    if (headerCheck.success === false) {

        addResult(filename, folder, fileSize);

        return true;

    }

    const header = headerCheck.header;

    /* Determine settings from the input file */

    const inputFileDataSize = header.data.size;

    /* Declare the return values */

    let timestamp = null;
    let latitude = null;
    let longitude = null;
    let sampleRate = null;
    let triggered = null;
    let samples = null;
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

            timestamp += timestampMatch[3].includes('+') ? '+' : '-';

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

    triggered = TRIGGER_REGEX.test(filename);

    /* Count samples */

    let progress = 0;

    if (triggered) {

        /* Read the input file to count samples */

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

                if (nextProgress !== progress) {

                    progress = nextProgress;

                    if (callback) callback(progress);

                }

            }

            /* Calculate the number of samples */

            samples /= NUMBER_OF_BYTES_IN_SAMPLE;

        } catch (e) {

            samples = null;

        }

    } else {

        samples = inputFileDataSize / NUMBER_OF_BYTES_IN_SAMPLE;

    }

    /* Calculate duration */

    duration = sampleRate !== undefined && sampleRate !== null ? Math.round(samples / sampleRate * MILLISECONDS_IN_SECOND) / MILLISECONDS_IN_SECOND : null;

    /* Determine temperature */

    if (TEMPERATURE_REGEX.test(comment)) {

        temperature = comment.match(TEMPERATURE_REGEX) ? comment.match(TEMPERATURE_REGEX)[1] : null;

    }

    /* Determine battery voltage */

    if (BATTERY_REGEX.test(comment)) {

        voltage = comment.match(BATTERY_GREATER_THAN_REGEX) ? '5.0' : comment.match(BATTERY_LESS_THAN_REGEX) ? '2.4' : comment.match(BATTERY_REGEX) ? comment.match(BATTERY_REGEX)[1] : null;

    }

    /* Check for the GUANO */

    if (header.data.size + header.size < fileSize) {

        const numberOfBytes = Math.min(fileSize - header.size - header.data.size, FILE_BUFFER_SIZE);

        /* Read the GUANO */

        try {

            /* Read end of file into the buffer */

            const numberOfBytesRead = fs.readSync(fi, fileBuffer, 0, numberOfBytes, header.data.size + header.size);

            if (numberOfBytesRead === numberOfBytes) {

                /* Parse the GUANO header */

                const guanoCheck = guanoHandler.readGuano(fileBuffer, numberOfBytes);

                if (guanoCheck.success) {

                    /* Read latitude and longitude */

                    const contents = guanoCheck.guano.contents;

                    let locationMatch = contents.match(GUANO_LOCATION_REGEX_2);

                    if (locationMatch) {

                        latitude = locationMatch[1];

                        longitude = locationMatch[2];

                    } else {

                        locationMatch = contents.match(GUANO_LOCATION_REGEX_6);

                        if (locationMatch) {

                            latitude = locationMatch[1];

                            longitude = locationMatch[2];

                        }

                    }

                    /* Read additional fields */

                    const timestampMatch = contents.match(GUANO_TIMESTAMP_REGEX);

                    const guanoTimestamp = timestampMatch ? timestampMatch[1] : null;

                    const temperatureMatch = contents.match(GUANO_TEMPERATURE_REGEX);

                    const guanoTemperature = temperatureMatch ? temperatureMatch[1] : null;

                    const voltageMatch = contents.match(GUANO_VOLTAGE_REGEX);

                    const guanoVoltage = voltageMatch ? voltageMatch[1] : null;

                    /* No exceptions so copy across GUANO data */

                    if (timestamp === null) timestamp = guanoTimestamp;

                    if (temperature === null) temperature = guanoTemperature;

                    if (voltage === null) voltage = guanoVoltage;

                }

            }

        } catch (e) {

            latitude = null;

            longitude = null;

        }

    }

    /* Close the file */

    try {

        fs.closeSync(fi);

    } catch (e) { }

    /* Add results and return */

    addResult(filename, folder, fileSize, timestamp, latitude, longitude, sampleRate, triggered, samples, duration, temperature, voltage, comment);

    if (callback && progress < 100) callback(100);

    /* Return success */

    return true;

}

/* Exports */

exports.initialise = initialise;
exports.summarise = summarise;
exports.finalise = finalise;
