/****************************************************************************
 * aligner.js
 * openacousticdevices.info
 * October 2024
 *****************************************************************************/

'use strict';

const fs = require('fs');
const path = require('path');

const wavHandler = require('./wavHandler.js');
const guanoHandler = require('./guanoHandler.js');
const filenameHandler = require('./filenameHandler.js');

/* Results constants */

const FIX_IDENTIFIER = "FIX";

const RECORD_IDENTIFIER = "RECORDING";

const MEDIAN_SAMPLERATE_IDENTIFIER = "MEDIAN";

const INTERPOLATION_SAMPLERATE_IDENTIFIER = "INTERPOLATION";

/* File buffer constants */

const NUMBER_OF_BYTES_IN_SAMPLE = 2;

const GUANO_BUFFER_SIZE = 32 * 1024;

const HEADER_BUFFER_SIZE = 32 * 1024;

const FILE_BUFFER_SIZE = 1024 * 1024;

/* Unit constants */

const MILLIHERTZ_IN_HERTZ = 1000;

/* Time constants */

const MINUTES_IN_HOUR = 60;

const SECONDS_IN_MINUTE = 60;

const MILLISECONDS_IN_SECOND = 1000;

/* GPS.TXT regex constants */

const TIMESTAMP_REGEX = /(\d\d)\/(\d\d)\/(\d{4}) (\d\d):(\d\d):(\d\d)\.(\d{3})/;

const TIME_SET_REGEX = /(\d\d\/\d\d\/\d{4} \d\d:\d\d:\d\d\.\d{3}) UTC: Time was set from GPS\./;

const TIME_UPDATED_REGEX = /(\d\d\/\d\d\/\d{4} \d\d:\d\d:\d\d\.\d{3}) UTC: Time was updated\. The internal clock was (\d+)ms (fast|slow)\./;

const TIME_NOT_UPDATED_REGEX = /(\d\d\/\d\d\/\d{4} \d\d:\d\d:\d\d\.\d{3}) UTC: Time was not updated\. The internal clock was correct\./;

const SAMPLE_RATE_REGEX = /(\d\d\/\d\d\/\d{4} \d\d:\d\d:\d\d\.\d{3}) UTC: Actual sample rate will be (\d+)\.(\d{3}) Hz\./;

const GPS_FIX_REGEX = /\d\d\/\d\d\/\d{4} \d\d:\d\d:\d\d\.\d{3} UTC: Received GPS fix - (\d+\.\d{6})°(N|S) (\d+\.\d{6})°(W|E)(?: \(.+\))? at (\d\d\/\d\d\/\d{4} \d\d:\d\d:\d\d\.\d{3}) UTC\./;

/* GUNAO regex constants */

const GUANO_LOCATION_REGEX_2 = /Loc Position:(\-?\d{1,2}\.\d{2}) (\-?\d{1,3}\.\d{2})/;

const GUANO_LOCATION_REGEX_6 = /Loc Position:(\-?\d{1,2}\.\d{6}) (\-?\d{1,3}\.\d{6})/;

const GUANO_TEMPERATURE_REGEX = /Temperature Int:(\-?\d+\.\d)/;

const GUANO_VOLTAGE_REGEX = /OAD\|Battery Voltage:(\d\.\d)/;

/* Header regex constants */

const HEADER_TIMEZONE_REGEX = /\(UTC([-|+]\d+)?:?(\d\d)?\)/;

const BATTERY_GREATER_THAN_REGEX = /greater than 4.9V/;

const BATTERY_LESS_THAN_REGEX = /less than 2.5V/;

const BATTERY_REGEX = /(\d\.\d)V/;

const TEMPERATURE_REGEX = /(-?\d+\.\d)C/;

/* Alignment constants */

const TIME_OFFSET_MULTIPLIER = 10;

const SAMPLE_RATE_CORRECTION = 2 / 48000000; 

const MAXIMUM_SAMPLE_RATE_ERROR_FROM_WAV_FILE = 100 * MILLIHERTZ_IN_HERTZ;

const MAXIMUM_SAMPLE_RATE_DIVERGENCE_RATIO_FROM_MEDIAN = 400 / 48000000;

/* Buffers for reading data */

const guanoBuffer = Buffer.alloc(GUANO_BUFFER_SIZE);

const headerBuffer = Buffer.alloc(HEADER_BUFFER_SIZE);

const fileBuffer = Buffer.alloc(FILE_BUFFER_SIZE);

/* Summary constants */

const HEADER = 'Timestamp,Event,Latitude,Longitude,Time Offset (ms),Start Sample Rate (Hz),End Sample Rate (Hz),Sample Rate Calculation,Filename,Samples,Duration (s),Temperature (C),Battery Voltage (V),Comment\r\n';

/* Global variables */

let fixes = [];

let recordings = [];

let currentFix = null;

let medianSampleRate = 0;

/* Little-endian sample read and write functions */

function readInt16 (buffer, index) {

    let value = buffer[index] + (buffer[index + 1] << 8);

    if (value > 0x7FFF) value -= 0x10000;

    return value;

}

function writeInt16 (buffer, index, value) {

    buffer[index] = value & 0xFF;

    buffer[index + 1] = (value >> 8) & 0xFF;

}

/* Function to sort the results file */

function resultsSorter (a, b) {

    return a.timestamp - b.timestamp;

}

/* Function to parse date string in file header */

function parseHeaderTimezone (comment) {

    let offset = null;

    const match = comment.match(HEADER_TIMEZONE_REGEX);

    if (match) {

        offset = 0;

        if (match[1]) {

            const negative = match[1].includes('-');

            const hours = parseInt(match[1], 10);

            offset = hours * MINUTES_IN_HOUR * SECONDS_IN_MINUTE * MILLISECONDS_IN_SECOND;

            if (match[2]) {

                let minutes = parseInt(match[2], 10);

                if (negative) minutes *= -1;

                offset += minutes * SECONDS_IN_MINUTE * MILLISECONDS_IN_SECOND;

            }

        }

    }

    return offset;

}

/* Functions to parse and format timestamps */

function parseTimestamp (dateString) {

    const match = dateString.match(TIMESTAMP_REGEX);

    const timestamp = Date.UTC(match[3], match[2] - 1, match[1], match[4], match[5], match[6], match[7]);

    return timestamp;

}

function digits (value, number) {

    const string = '00000' + value;

    return string.substr(string.length - number);

}

function formatTimestamp(timestamp, offset) {

    const date = new Date(timestamp);

    let string = date.getUTCFullYear() + '-' + digits(date.getUTCMonth() + 1, 2) + '-' + digits(date.getUTCDate(), 2) + 'T' + digits(date.getUTCHours(), 2) + ':' + digits(date.getUTCMinutes(), 2) + ':' + digits(date.getUTCSeconds(), 2);

    if (offset == 0) {

        string += 'Z';

    } else {

        string += offset < 0 ? '-' : '+';

        offset = Math.abs(offset / SECONDS_IN_MINUTE / MILLISECONDS_IN_SECOND);

        const hours = Math.floor(offset / MINUTES_IN_HOUR);

        string += digits(hours, 2) + ':';

        const minutes = offset % MINUTES_IN_HOUR;

        string += digits(minutes , 2);

    }

    return string;

}

/* Process a line from the GPS.TXT file from the standard firmware */

function processLine(line) {

    const gpsFixMatch = line.match(GPS_FIX_REGEX);

    if (gpsFixMatch) {

        const timestamp = parseTimestamp(gpsFixMatch[5]);

        const longitude = (gpsFixMatch[4] === 'W' ? '-' : '') + gpsFixMatch[3];

        const latitude = (gpsFixMatch[2] === 'S' ? '-' : '') + gpsFixMatch[1];

        if (currentFix === null) {

            currentFix = {
                event: FIX_IDENTIFIER
            };

        }
        
        currentFix.timestamp = timestamp;
        currentFix.longitude = longitude;
        currentFix.latitude = latitude;

        currentFix.timeOffset = null;

        return;

    }

    const timeSetMatch = line.match(TIME_SET_REGEX);

    if (timeSetMatch) {

        const timestamp = parseTimestamp(timeSetMatch[1]);

        if (currentFix !== null && timestamp === currentFix.timestamp + MILLISECONDS_IN_SECOND) {
            
            currentFix.timestamp += MILLISECONDS_IN_SECOND;

            currentFix.timeOffset = 0;

        }

        return;

    }

    const timeNotUpdatedMatch = line.match(TIME_NOT_UPDATED_REGEX);

    if (timeNotUpdatedMatch) {

        const timestamp = parseTimestamp(timeNotUpdatedMatch[1]);

        if (currentFix !== null && timestamp === currentFix.timestamp + MILLISECONDS_IN_SECOND) {

            currentFix.timestamp += MILLISECONDS_IN_SECOND;

            currentFix.timeOffset = 0;

        }

        return;

    }

    const timeUpdatedMatch = line.match(TIME_UPDATED_REGEX);

    if (timeUpdatedMatch) {

        const timestamp = parseTimestamp(timeUpdatedMatch[1]);

        if (currentFix !== null && timestamp === currentFix.timestamp + MILLISECONDS_IN_SECOND) {

            currentFix.timestamp += MILLISECONDS_IN_SECOND;
            
            let timeOffset = TIME_OFFSET_MULTIPLIER * parseInt(timeUpdatedMatch[2], 10);

            timeOffset *= timeUpdatedMatch[3] === 'fast' ? -1 : 1;

            if (timeOffset > 0) timeOffset += TIME_OFFSET_MULTIPLIER / 2;

            if (timeOffset < 0) timeOffset -= TIME_OFFSET_MULTIPLIER / 2;

            currentFix.timeOffset = timeOffset;

        }

        return;

    }

    const sampleRateMatch = line.match(SAMPLE_RATE_REGEX);

    if (sampleRateMatch) {

        const timestamp = parseTimestamp(sampleRateMatch[1]);

        if (currentFix !== null && currentFix.timeOffset !== null && timestamp === currentFix.timestamp) {

            const sampleRate = MILLIHERTZ_IN_HERTZ * parseInt(sampleRateMatch[2], 10) + parseInt(sampleRateMatch[3], 10);

            currentFix.sampleRate = sampleRate;

            fixes.push(currentFix);

            currentFix = null;

        }

    }

}

/* Initialise by parsing the GPS.TXT file from the standard firmware */

function initialise (inputPath) {

    /* Open input GPS.TXT file */

    let fi;

    try {

        fi = fs.openSync(inputPath, 'r');

    } catch (e) {

        return {
            success: false,
            error: 'Could not open the GPS.TXT file.'
        };

    }
    
    let fileSize;

    try {

        fileSize = fs.statSync(inputPath).size;

    } catch (e) {

        return {
            success: false,
            error: 'Could not read the GPS.TXT file size.'
        };

    }

    if (fileSize === 0) {

        return {
            success: false,
            error: 'The GPS.TXT file has zero size.'
        };

    }

    /* Initialise fixes and recordings list */

    fixes = [];

    recordings = [];

    /* Read each line */

    try {

        let buffer = '';

        let numberOfBytesRead = 0;

        while (numberOfBytesRead < fileSize) {

            const numberOfBytes = Math.min(FILE_BUFFER_SIZE, fileSize - numberOfBytesRead);

            fs.readSync(fi, fileBuffer, 0, numberOfBytes, null);

            const newLines = buffer.concat(fileBuffer.slice(0, numberOfBytes)).toString().split(/\r?\n/);

            buffer = newLines.pop();

            while (newLines.length > 0) {

                const line = newLines.shift();

                processLine(line);

            }

            numberOfBytesRead += numberOfBytes;

        }

    } catch (e) {

        return {
            success: false,
            error: 'Something went wrong parsing the GPS.TXT file.'
        };

    }

    /* Check sufficient fixes */

    if (fixes.length < 2) {

        return {
            success: false,
            error: 'Insufficient fixes within the GPS.TXT file to estimate clock drift.'
        };

    }
    
    /* Sort the fixes */

    fixes = fixes.sort(resultsSorter);

    /* Find the median sample rate */

    let sampleRates = [];

    for (let i = 0; i < fixes.length; i += 1) {

        sampleRates.push(fixes[i].sampleRate);

    }

    sampleRates = sampleRates.sort();

    const midPoint = Math.floor(fixes.length / 2);

    medianSampleRate = sampleRates[midPoint];

    /* Return success */

    return {
        success: true,
        error: null
    };
    
}

/* Finalise by writing the GPS.CVS file */

function finalise (outputPath) {

    /* Sort the recordings */

    const sortedRecordings = recordings.sort(resultsSorter);

    /* Write the output file */

    try {

        /* Check the output path */

        if (fs.lstatSync(outputPath).isDirectory() === false) {

            return {
                success: false,
                error: 'Destination path for GPS.CSV is not a directory.'
            };

        }

        /* Write the output file */

        const fo = fs.openSync(path.join(outputPath, 'GPS.CSV'), 'w');

        fs.writeSync(fo, HEADER);

        let fixIndex = 0;
        let recordingIndex = 0;

        while (fixIndex < fixes.length) {

            const currrentFix = fixes[fixIndex];

            /* Write fix */

            let line = formatTimestamp(currrentFix.timestamp, 0) + ',';

            line += currrentFix.event + ',' + currrentFix.latitude + ',' + currrentFix.longitude + ',';

            line += currrentFix.timeOffset < 0 ? '-' : '';

            line += Math.floor(Math.abs(currrentFix.timeOffset) / TIME_OFFSET_MULTIPLIER) + '.' + Math.abs(currrentFix.timeOffset) % TIME_OFFSET_MULTIPLIER + ',';

            line += Math.floor(currrentFix.sampleRate / MILLIHERTZ_IN_HERTZ) + '.' + digits(currrentFix.sampleRate % MILLIHERTZ_IN_HERTZ, 3) + ',,,,,,,\r\n';

            fs.writeSync(fo, line);

            /* Check next recording */

            while (recordingIndex < sortedRecordings.length) {

                const currentRecording = sortedRecordings[recordingIndex];

                if (fixIndex < fixes.length - 1) {

                    const nextFix = fixes[fixIndex + 1];

                    if (currentRecording.timestamp > nextFix.timestamp) break;

                }

                /* Write the recording */

                let line = formatTimestamp(currentRecording.timestamp + currentRecording.timezoneOffset, currentRecording.timezoneOffset) + ',';

                line += currentRecording.event + ',';
                
                line += (currentRecording.latitude ? currentRecording.latitude : '') + ',';
                
                line += (currentRecording.longitude ? currentRecording.longitude : '') + ',';

                line += currentRecording.timeOffset < 0 ? '-' : '';
    
                line += Math.floor(Math.abs(currentRecording.timeOffset) / TIME_OFFSET_MULTIPLIER) + '.' + Math.abs(currentRecording.timeOffset) % TIME_OFFSET_MULTIPLIER + ',';
                    
                line += Math.floor(currentRecording.sampleRateStart / MILLIHERTZ_IN_HERTZ) + '.' + digits(currentRecording.sampleRateStart % MILLIHERTZ_IN_HERTZ, 3) + ',';

                line += Math.floor(currentRecording.sampleRateEnd / MILLIHERTZ_IN_HERTZ) + '.' + digits(currentRecording.sampleRateEnd % MILLIHERTZ_IN_HERTZ, 3) + ',';

                line += currentRecording.sampleRateCalculation + ',';

                line += currentRecording.filename + ',';

                line += currentRecording.samples + ',' + currentRecording.duration + ',';
                
                line += (currentRecording.temperature ? currentRecording.temperature : '') + ',';
                
                line += (currentRecording.voltage ? currentRecording.voltage : '') + ',';
                
                line += (currentRecording.comment ? currentRecording.comment : '') + '\r\n';
    
                fs.writeSync(fo, line);

                /* Increment counter */

                recordingIndex += 1;

            }

            /* Increment counter */

            fixIndex += 1;

        }

        fs.closeSync(fo);

    } catch (e) {

        return {
            success: false,
            error: 'An error occurred while writing the GPS.CSV  file.'
        };

    }

    /* Return success */

    return {
        success: true,
        error: null
    };

}

/* Align a WAV file from the standard firmware */

function align (inputPath, outputPath, prefix, onlyProcessFilesBetweenFixes, callback) {

    /* Check prefix parameter */

    prefix = prefix || '';

    if (typeof prefix !== 'string') {

        return {
            success: false,
            error: 'Filename prefix must be a string.'
        };

    }

    /* Check processOutsideFiles parameter */

    onlyProcessFilesBetweenFixes = typeof onlyProcessFilesBetweenFixes === 'boolean' ? onlyProcessFilesBetweenFixes : true;

    /* Open input WAV file */

    let fi;

    try {

        fi = fs.openSync(inputPath, 'r');

    } catch (e) {

        return {
            success: false,
            error: 'Could not open input WAV file.'
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
            error: 'Could not read input WAV file size.'
        };

    }

    if (fileSize === 0) {

        return {
            success: false,
            error: 'Input WAV file has zero size.'
        };

    }

    /* Read the WAV file header */

    try {

        fs.readSync(fi, headerBuffer, 0, HEADER_BUFFER_SIZE, 0);

    } catch (e) {

        return {
            success: false,
            error: 'Could not read the input WAV file header.'
        };

    }

    /* Check the header */

    const headerCheck = wavHandler.readHeader(headerBuffer, fileSize);

    if (headerCheck.success === false) return headerCheck;

    /* Extract the header */

    const header = headerCheck.header;

    const comment = header.icmt.comment;

    /* Check the filename against header */

    const inputFilename = path.parse(inputPath).base;

    const filenameCheck = filenameHandler.checkFilenameAgainstHeader(filenameHandler.SYNC, inputFilename, header.icmt.comment, header.iart.artist);

    if (filenameCheck.success === false) return filenameCheck;

    /* Extract and correct timestamp */

    const localTimestamp = filenameCheck.originalTimestamp;

    const timezoneOffset = parseHeaderTimezone(comment);

    if (timezoneOffset === null) {

        return {
            success: false,
            error: 'Cannot find timezone in the input WAV file header.'
        };

    }

    const timestamp = localTimestamp - timezoneOffset;

    /* Calculate sample rate and duration */

    const sampleRate = header.wavFormat.samplesPerSecond;

    const samples = header.data.size / NUMBER_OF_BYTES_IN_SAMPLE;

    const duration = Math.round(samples / sampleRate * MILLISECONDS_IN_SECOND) / MILLISECONDS_IN_SECOND;

    /* Determine temperature */

    let temperature = null;

    if (TEMPERATURE_REGEX.test(comment)) {

        temperature = comment.match(TEMPERATURE_REGEX) ? comment.match(TEMPERATURE_REGEX)[1] : null;

    }

    /* Determine battery voltage */

    let voltage = null;

    if (BATTERY_REGEX.test(comment)) {

        voltage = comment.match(BATTERY_GREATER_THAN_REGEX) ? '5.0' : comment.match(BATTERY_LESS_THAN_REGEX) ? '2.4' : comment.match(BATTERY_REGEX) ? comment.match(BATTERY_REGEX)[1] : null;

    }

    /* Read the GUANO if present */

    let guano;

    let latitude = null;

    let longitude = null;

    if (header.data.size + header.size < fileSize) {

        const numberOfBytes = Math.min(fileSize - header.size - header.data.size, GUANO_BUFFER_SIZE);

        try {

            /* Read end of file into the buffer */

            const numberOfBytesRead = fs.readSync(fi, guanoBuffer, 0, numberOfBytes, header.data.size + header.size);

            if (numberOfBytesRead === numberOfBytes) {

                /* Parse the GUANO header */

                const guanoCheck = guanoHandler.readGuano(guanoBuffer, numberOfBytes);

                if (guanoCheck.success) {

                    guano = guanoCheck.guano;

                    /* Read latitude and longitude */

                    const contents = guano.contents;

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

                    const temperatureMatch = contents.match(GUANO_TEMPERATURE_REGEX);

                    const guanoTemperature = temperatureMatch ? temperatureMatch[1] : null;

                    const voltageMatch = contents.match(GUANO_VOLTAGE_REGEX);

                    const guanoVoltage = voltageMatch ? voltageMatch[1] : null;

                    /* No exceptions so copy across GUANO data */

                    if (temperature === null) temperature = guanoTemperature;

                    if (voltage === null) voltage = guanoVoltage;

                }

            }

        } catch (e) {

            guano = null;

        }

    }

    /* Check if recording is before or after fixes */

    let timeOffset = 0;

    let sampleRateError = 0;

    let sampleRateStart = 0;

    let sampleRateEnd = 0;

    const firstFix = fixes[0];

    const lastFix = fixes[fixes.length - 1];

    let sampleRateCalculation = INTERPOLATION_SAMPLERATE_IDENTIFIER;

    if (timestamp < firstFix.timestamp) {
    
        return {
            success: false,
            error: 'Recording is before first GPS fix. No correction possible.'
        };

    } else if (timestamp > lastFix.timestamp) {

        if (onlyProcessFilesBetweenFixes) {

            return {
                success: false,
                error: 'Recording is after last GPS fix.'
            };

        }

        /* Calculate time offset */

        const clockDrift = lastFix.timeOffset / (lastFix.timestamp - fixes[fixes.length - 2].timestamp); 

        timeOffset = Math.round(clockDrift * (timestamp - lastFix.timestamp));

        /* Calculate sample rate error from median */

        sampleRateError = Math.abs(lastFix.sampleRate - medianSampleRate);

        /* Check sample rate error */

        if (sampleRateError > MAXIMUM_SAMPLE_RATE_DIVERGENCE_RATIO_FROM_MEDIAN * medianSampleRate) {

            /* Calculate start and end sample rate */

            sampleRateStart = medianSampleRate;

            sampleRateEnd = medianSampleRate;

            sampleRateCalculation = MEDIAN_SAMPLERATE_IDENTIFIER;

            /* Calculate sample rate error from WAV file sample rate */

            sampleRateError = Math.abs(medianSampleRate - sampleRate * MILLIHERTZ_IN_HERTZ);

        } else {

            /* Calculate start and end sample rate */

            sampleRateStart = lastFix.sampleRate;

            sampleRateEnd = lastFix.sampleRate;

            /* Calculate sample rate error from WAV file sample rate */

            sampleRateError = Math.abs(lastFix.sampleRate - sampleRate * MILLIHERTZ_IN_HERTZ);

        }
         
    } else {

        /* Find fixes on either side of the recording */

        let index = 0;

        while (timestamp > fixes[index].timestamp) index += 1;

        const fixAfter = fixes[index];

        const fixBefore = fixes[index - 1];

        /* Check that recording timestamp does equal fix timestamp */

        if (timestamp === fixBefore.timestamp || timestamp === fixAfter.timestamp) {

            return {
                success: false,
                error: 'Recording has the same time as a GPS fix.'
            };
    
        }

        /* Calculate time offset */

        const clockDrift = fixAfter.timeOffset / (fixAfter.timestamp - fixBefore.timestamp); 

        timeOffset = Math.round(clockDrift * (timestamp - fixBefore.timestamp));
        
        /* Calculate sample rate error from median */

        const sampleRateErrorBefore = Math.abs(fixBefore.sampleRate - medianSampleRate);

        const sampleRateErrorAfter = Math.abs(fixAfter.sampleRate - medianSampleRate);

        sampleRateError = Math.max(sampleRateErrorBefore, sampleRateErrorAfter);

        /* Check sample rate error */

        if (sampleRateError > MAXIMUM_SAMPLE_RATE_DIVERGENCE_RATIO_FROM_MEDIAN * medianSampleRate) {

            /* Calculate start and end sample rate */

            sampleRateStart = medianSampleRate;

            sampleRateEnd = medianSampleRate;

            sampleRateCalculation = MEDIAN_SAMPLERATE_IDENTIFIER;

            /* Calculate sample rate error from WAV file sample rate */

            sampleRateError = Math.abs(medianSampleRate - sampleRate * MILLIHERTZ_IN_HERTZ);

        } else {

            /* Calculate start and end sample rate */

            const sampleRateDrift = (fixAfter.sampleRate - fixBefore.sampleRate) / (fixAfter.timestamp - fixBefore.timestamp);

            sampleRateStart = Math.round(fixBefore.sampleRate + sampleRateDrift * (timestamp - fixBefore.timestamp));

            sampleRateEnd = Math.round(fixBefore.sampleRate + sampleRateDrift * (timestamp + duration * MILLISECONDS_IN_SECOND - fixBefore.timestamp));

            /* Calculate sample rate error from WAV file sample rate */

            const sampleRateErrorStart = Math.abs(sampleRateStart - sampleRate * MILLIHERTZ_IN_HERTZ);

            const sampleRateErrorEnd = Math.abs(sampleRateEnd - sampleRate * MILLIHERTZ_IN_HERTZ);

            sampleRateError = Math.max(sampleRateErrorStart, sampleRateErrorEnd);

        }
        
    }

    /* Check the sample rate against WAV file */

    if (sampleRateError > MAXIMUM_SAMPLE_RATE_ERROR_FROM_WAV_FILE) {

        return {
            success: false,
            error: 'Sample rate does not match expected sample rate.'
        };

    }

    /* Make the results object */

    const currentRecording = {
        timestamp: timestamp,
        timezoneOffset: timezoneOffset,
        event: RECORD_IDENTIFIER,
        filename: inputFilename,
        latitude: latitude,
        longitude: longitude,
        duration: duration,
        samples: samples,
        temperature: temperature,
        voltage: voltage,
        comment: comment,
        timeOffset: timeOffset,
        sampleRateStart: sampleRateStart,
        sampleRateEnd: sampleRateEnd,
        sampleRateCalculation, sampleRateCalculation
    };

    recordings.push(currentRecording);

    /* Allocate space for input and output */

    const syncInputBuffer = Buffer.alloc(FILE_BUFFER_SIZE);

    const syncOutputBuffer = Buffer.alloc(FILE_BUFFER_SIZE);

    /* Generate output filename */

    const outputFilename = (prefix === '' ? '' : prefix + '_') + inputFilename.replace('.WAV', '_SYNC.WAV');

    /* Open the output file and write the header */

    const fo = fs.openSync(path.join(outputPath, outputFilename), 'w');

    fs.writeSync(fo, headerBuffer, 0, header.size, null);

    /* Reset the input file to end of header */

    fs.readSync(fi, headerBuffer, 0, header.size, null);

    /* Read the first file buffer */

    fs.readSync(fi, syncInputBuffer, 0, FILE_BUFFER_SIZE, null);

    /* Function to read sample values */

    function readSampleValue () {

        const sampleValue = readInt16(syncInputBuffer, inputBufferIndex * NUMBER_OF_BYTES_IN_SAMPLE);

        numberOfSamplesRead += 1;

        inputBufferIndex += 1;

        if (inputBufferIndex === FILE_BUFFER_SIZE / NUMBER_OF_BYTES_IN_SAMPLE) {

            fs.readSync(fi, syncInputBuffer, 0, FILE_BUFFER_SIZE, null);

            inputBufferIndex = 0;

        }

        return sampleValue;

    }

    /* Function to write sample value */

    function writeSampleValue (value) {

        writeInt16(syncOutputBuffer, outputBufferIndex * NUMBER_OF_BYTES_IN_SAMPLE, value);

        numberOfSamplesWritten += 1;

        outputBufferIndex += 1;

        if (outputBufferIndex === FILE_BUFFER_SIZE / NUMBER_OF_BYTES_IN_SAMPLE) {

            fs.writeSync(fo, syncOutputBuffer, 0, FILE_BUFFER_SIZE, null);

            outputBufferIndex = 0;

        }

    }

    /* Initialise counters */

    let progress = 0;

    let inputBufferIndex = 0;

    let outputBufferIndex = 0;

    let numberOfSamplesRead = 0;

    let numberOfSamplesWritten = 0;

    const numberOfSamplesToRead = samples;

    const numberOfSamplesToWrite = samples;

    /* Read first sample */

    let sampleValue = numberOfSamplesToRead > 0 ? readSampleValue() : 0;

    /* Correct for the time offset */

    if (timeOffset < 0) {

        /* Clock is fast. Drop samples at the start */

        const numberOfSamples = Math.round(-timeOffset / TIME_OFFSET_MULTIPLIER / MILLISECONDS_IN_SECOND * sampleRateStart / MILLIHERTZ_IN_HERTZ); 

        while (numberOfSamplesRead < numberOfSamples && numberOfSamplesRead < numberOfSamplesToRead) sampleValue = readSampleValue();

    } else if (timeOffset > 0) {

        /* Clock is slow. Add additional samples at the start */

        const numberOfSamples = Math.round(timeOffset / TIME_OFFSET_MULTIPLIER / MILLISECONDS_IN_SECOND * sampleRate); 

        while (numberOfSamplesWritten < numberOfSamples && numberOfSamplesWritten < numberOfSamplesToWrite) writeSampleValue(sampleValue); 

    }

    /* Read and write the rest of the samples */

    let inputOffset = 0;

    let previousSampleValue = sampleValue;

    let previousInputOffset = inputOffset;

    while (numberOfSamplesWritten < numberOfSamplesToWrite) {

        let count = 0;

        let outputOffset = 0;

        let inputSampleRate = sampleRateStart + (numberOfSamplesWritten / numberOfSamplesToWrite) * (sampleRateEnd - sampleRateStart);

        inputSampleRate -= inputSampleRate * SAMPLE_RATE_CORRECTION;

        const inputOffsetStep = MILLIHERTZ_IN_HERTZ / inputSampleRate;

        while (count < sampleRate && numberOfSamplesWritten < numberOfSamplesToWrite) {

            /* Read input samples */

            while (inputOffset <= outputOffset) {

                previousInputOffset = inputOffset;

                previousSampleValue = sampleValue;

                if (numberOfSamplesRead < numberOfSamplesToRead) sampleValue = readSampleValue();

                inputOffset += inputOffsetStep;

            }

            /* Write the sample value */

            let interpolatedSampleValue = previousSampleValue + Math.round((outputOffset - previousInputOffset) / (inputOffset - previousInputOffset) * (sampleValue - previousSampleValue));

            if (inputOffset === previousInputOffset) interpolatedSampleValue = previousSampleValue;

            writeSampleValue(interpolatedSampleValue);     
            
            /* Increment output offset and counter */

            outputOffset += 1 / sampleRate;

            count += 1;

        }

        /* Decrement input offset */

        inputOffset -= 1;

        /* Callback with progress */

        const newProgress = Math.round(100 * numberOfSamplesWritten / numberOfSamplesToWrite);

        if (newProgress > progress) {

            if (callback) callback(newProgress);

            progress = newProgress;

        }

    }

    /* Flush the output buffer */

    if (outputBufferIndex > 0) {

        fs.writeSync(fo, syncOutputBuffer, 0, outputBufferIndex * NUMBER_OF_BYTES_IN_SAMPLE, null);

    }

    /* Write the GUANO */

    if (guano) {

        guanoHandler.writeGuano(syncOutputBuffer, guano);

        fs.writeSync(fo, syncOutputBuffer, 0, guano.size, null);

    }

    /* Make last progress callback */

    if (callback && progress < 100) callback(100);

    /* Close both files */

    fs.closeSync(fi);

    fs.closeSync(fo);

    /* Return success */

    return {
        success: true,
        error: null
    };

}

/* Exports */

exports.initialise = initialise;
exports.align = align;
exports.finalise = finalise;