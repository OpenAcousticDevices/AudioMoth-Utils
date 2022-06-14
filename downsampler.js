/****************************************************************************
 * downsampler.js
 * openacousticdevices.info
 * June 2022
 *****************************************************************************/

'use strict';

const fs = require('fs');
const path = require('path');

const wavHeader = require('./wavHeader.js');

/* Debug constant */

const DEBUG = false;

/* Downsample constants */

const INT16_MIN = -32768;

const INT16_MAX = 32767;

const HERTZ_IN_KILOHERTZ = 1000;

const DEFAULT_SAMPLE_RATE = 48000;

/* Valid sample rate */

const validSampleRates = [8000, 16000, 32000, 48000, 96000, 192000, 250000, 384000];

/* File buffer constants */

const NUMBER_OF_BYTES_IN_SAMPLE = 2;

const FILE_BUFFER_SIZE = 32 * 1024;

const FILENAME_REGEX = /^(\d\d\d\d\d\d\d\d_)?\d\d\d\d\d\d.WAV$/;

/* Time constants */

const SECONDS_IN_DAY = 24 * 60 * 60;

const MILLISECONDS_IN_SECONDS = 1000;

const DATE_REGEX = /Recorded at (\d\d):(\d\d):(\d\d) (\d\d)\/(\d\d)\/(\d\d\d\d)/;

/* Buffers for reading data */

const inputBuffer = Buffer.alloc(FILE_BUFFER_SIZE);

const outputBuffer = Buffer.alloc(FILE_BUFFER_SIZE);

const headerBuffer = Buffer.alloc(FILE_BUFFER_SIZE);

/* Date functions */

function digits (value, number) {

    const string = '00000' + value;

    return string.substr(string.length - number);

}

function formatFilename (timestamp) {

    const date = new Date(timestamp);

    let filename = date.getUTCFullYear() + digits(date.getUTCMonth() + 1, 2) + digits(date.getUTCDate(), 2) + '_' + digits(date.getUTCHours(), 2) + digits(date.getUTCMinutes(), 2) + digits(date.getUTCSeconds(), 2);

    filename += '.WAV';

    return filename;

}

/* Greatest common divisor function */

function greatestCommonDivider(a, b) {

    var c;

    while (a != 0) {
        c = a; 
        a = b % a;  
        b = c;
    }

    return b;

}

/* Little-endian sample read and write functions */

function readInt16(buffer, index) {

    let value = buffer[index] + (buffer[index + 1] << 8);

    if (value > 0x7FFF) value -= 0x10000;

    return value;

}

function writeInt16(buffer, index, value) {

    buffer[index] = value & 0xFF;

    buffer[index + 1] = (value >> 8) & 0xFF;

}

/* Downsample a WAV file */

function downsample (inputPath, outputPath, prefix, requestedSampleRate, callback) {

    var fileSize, fi, fo;

    /* Check parameter */

    prefix = prefix || '';

    if (typeof prefix !== 'string') {

        return {
            success: false,
            error: 'Filename prefix must be a string.'
        };

    }

    if (typeof requestedSampleRate !== 'number') {

        return {
            success: false,
            error: 'Requested sample rate must be a number.'
        };

    }

    let requestedSampleRateCheck = false;

    for (let i = 0; i < validSampleRates.length; i += 1) {
    
        if (requestedSampleRate === validSampleRates[i]) requestedSampleRateCheck = true;
    
    }

    if (requestedSampleRateCheck == false) {

        return {
            success: false,
            error: 'Requested sample rate is not valid.'
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

    const headerCheck = wavHeader.readHeader(headerBuffer, fileSize);

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

    /* Check the original sample rate */

    const originalSampleRate = header.wavFormat.samplesPerSecond;

    if (requestedSampleRate > originalSampleRate) {

        return {
            success: false,
            error: 'Requested sample rate is greater than original sample rate.'
        };

    }  

    /* Determine settings from the input file */

    const numberOfSamplesInInput = header.data.size / NUMBER_OF_BYTES_IN_SAMPLE;

    /* Determine timestamp of input file */

    const regex = DATE_REGEX.exec(header.icmt.comment);

    const timestamp = Date.UTC(regex[6], regex[5] - 1, regex[4], regex[1], regex[2], regex[3]);

    const filename = (prefix === '' ? '' : prefix + '_') + formatFilename(timestamp);

    /* Calculate the downsampling parameters */

    const sampleRateDivider = Math.ceil(originalSampleRate / requestedSampleRate);

    const rawSampleRate = sampleRateDivider * requestedSampleRate;

    const step = originalSampleRate / rawSampleRate;

    /* Calculate the number of samples to read and write */

    const gcd = greatestCommonDivider(originalSampleRate / HERTZ_IN_KILOHERTZ, requestedSampleRate / HERTZ_IN_KILOHERTZ);

    const divider = originalSampleRate / HERTZ_IN_KILOHERTZ / gcd;

    const multiplier = requestedSampleRate / HERTZ_IN_KILOHERTZ / gcd;

    const numberOfSamplesToWrite = Math.floor(numberOfSamplesInInput / divider) * multiplier;

    let progress = 0;

    try {

        /* Open the output file */

        fo = fs.openSync(path.join(outputPath, filename), 'w');

        /* Write the header */

        wavHeader.updateDataSize(header, numberOfSamplesToWrite * NUMBER_OF_BYTES_IN_SAMPLE);

        wavHeader.updateSampleRate(header, requestedSampleRate);

        wavHeader.writeHeader(headerBuffer, header);

        fs.writeSync(fo, headerBuffer, 0, header.size, null);

        /* Write the data */

        if (numberOfSamplesToWrite > 0) {
            
            let count = 0;

            let total = 0;

            let position = 0;

            let numberOfSamplesWritten = 0;

            /* Reset to end of header */

            fs.readSync(fi, headerBuffer, 0, header.size, null);

            /* Read first value */

            fs.readSync(fi, inputBuffer, 0, FILE_BUFFER_SIZE, null);

            let nextSample = readInt16(inputBuffer, 0);

            let numberOfSamplesRead = 1;

            /* Main loop */

            while (numberOfSamplesWritten < numberOfSamplesToWrite) {

                /* Read next sample */

                let currentSample = nextSample;

                const numberOfSamplesInBuffer = numberOfSamplesRead % (FILE_BUFFER_SIZE / NUMBER_OF_BYTES_IN_SAMPLE);

                if (numberOfSamplesInBuffer == 0) fs.readSync(fi, inputBuffer, 0, FILE_BUFFER_SIZE, null);

                if (numberOfSamplesRead < numberOfSamplesInInput) {

                    const index = numberOfSamplesInBuffer * NUMBER_OF_BYTES_IN_SAMPLE;

                    nextSample = readInt16(inputBuffer, index);

                }

                numberOfSamplesRead += 1;

                /* Interpolate until a new sample is required */

                while (position < 1.0 && numberOfSamplesWritten < numberOfSamplesToWrite) {

                    const interpolatedSample = currentSample + position * (nextSample - currentSample);

                    total += interpolatedSample;

                    count += 1;

                    /* Write a new output sample */

                    if (count == sampleRateDivider) {

                        let value = total / sampleRateDivider;

                        value = Math.sign(value) * Math.round(Math.abs(value));

                        value = Math.max(INT16_MIN, Math.min(INT16_MAX, value));

                        const numberOfSamplesInBuffer = numberOfSamplesWritten % (FILE_BUFFER_SIZE / NUMBER_OF_BYTES_IN_SAMPLE);

                        const index = numberOfSamplesInBuffer * NUMBER_OF_BYTES_IN_SAMPLE;

                        writeInt16(outputBuffer, index, value);

                        if (index == FILE_BUFFER_SIZE - NUMBER_OF_BYTES_IN_SAMPLE) fs.writeSync(fo, outputBuffer, 0, FILE_BUFFER_SIZE, null);

                        numberOfSamplesWritten += 1;

                        total = 0;

                        count = 0;

                    }

                    position += step;

                    /* Update progress */

                    const nextProgress = Math.round(100 * numberOfSamplesWritten / numberOfSamplesToWrite);

                    if (nextProgress > progress) {
    
                        progress = nextProgress;
        
                        if (callback) callback(progress);
        
                    }

                }

                position -= 1.0;

            }

            const numberOfSamplesInBuffer = numberOfSamplesWritten % (FILE_BUFFER_SIZE / NUMBER_OF_BYTES_IN_SAMPLE);

            if (numberOfSamplesInBuffer > 0) fs.writeSync(fo, outputBuffer, 0, numberOfSamplesInBuffer * NUMBER_OF_BYTES_IN_SAMPLE, null);

        }

    } catch (e) {

        return {
            success: false,
            error: 'Error occurred while downsampling files. ' + e
        };

    }

    if (callback && progress < 100) callback(100);

    /* Close the input and output files */

    fs.closeSync(fi);

    fs.closeSync(fo);

    /* Return success */

    return {
        success: true,
        error: null
    };

}

/* Export downsample */

exports.downsample = downsample;
