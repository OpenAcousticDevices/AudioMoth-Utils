/****************************************************************************
 * syncer.js
 * openacousticdevices.info
 * October 2022
 *****************************************************************************/

'use strict';

const fs = require('fs');
const path = require('path');

const csvReader = require('./csvReader.js');

const wavHandler = require('./wavHandler.js');
const guanoHandler = require('./guanoHandler.js');
const filenameHandler = require('./filenameHandler.js');

/* Debug constant */

const DEBUG = false;

const FIX_PPS_EVENTS = true;

const ALIGN_SAMPLES = true;

/* File buffer constants */

const UINT32_MAX = 0xFFFFFFFF;

const NUMBER_OF_BYTES_IN_SAMPLE = 2;

const HEADER_BUFFER_SIZE = 32 * 1024;

const FILE_BUFFER_SIZE = 1024 * 1024;

/* Time constants */

const HERTZ_IN_KILOHERTZ = 1000;

const MILLISECONDS_IN_SECOND = 1000;

const MICROSECONDS_IN_SECOND = 1000 * MILLISECONDS_IN_SECOND;

/* PPS accuracy constants */

const MAX_HFXO_ERROR_ABSOLUTE = 100 / 1000000;

const MAX_HFXO_ERROR_RELATIVE = 40 / 1000000;

const MAX_LFXO_ERROR = 100 / 1000000;

/* AudioMoth buffer constants */

const CLOCK_DIVIDER = 4;

const CONVERSION_CYCLES = 12;

const ACQUISITION_CYCLES = 16;

const CLOCK_FREQUENCY = 48000000;

const MAXIMUM_ALLOWABLE_SAMPLE_RATE = 192000;

const MAXIMUM_REFERENCE_SAMPLE_RATE = 384000;

/* File check constants */

const NUMBER_OF_BUFFERS = 8;

const PPS_CLOCK_TICK_OFFSET = 2 + CLOCK_DIVIDER;

const MAXIMUM_ALLOWABLE_PPS_OFFSET = (PPS_CLOCK_TICK_OFFSET / CLOCK_FREQUENCY * MICROSECONDS_IN_SECOND);

const MAXIMUM_ALLOWABLE_TIMESTAMP_DIFFERENCE = 500;

/* Buffers for reading data */

const headerBuffer = Buffer.alloc(HEADER_BUFFER_SIZE);

/* Date functions */

function digits (value, number) {

    const string = '00000' + value;

    return string.substring(string.length - number);

}

/* Greatest common divisor function */

function greatestCommonDivider (a, b) {

    let c;

    while (a !== 0) {

        c = a;
        a = b % a;
        b = c;

    }

    return b;

}

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

/* Sync a WAV file from the AudioMoth-GPS-Sync firmware */

function sync (inputPath, outputPath, prefix, resampleRate, autoResolve, callback) {

    /* Check prefix parameter */

    prefix = prefix || '';

    if (typeof prefix !== 'string') {

        return {
            success: false,
            error: 'Filename prefix must be a string.'
        };

    }

    /* Check autoResolve parameter */

    autoResolve = typeof autoResolve === 'boolean' ? autoResolve : false;

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

    /* Check the resample rate */

    if (typeof resampleRate === 'number') {

        if (resampleRate < header.wavFormat.samplesPerSecond) {

            return {
                success: false,
                error: 'Resample rate is less than original sample rate.'
            };

        }

    }

    /* Check the filename against header */

    const inputFilename = path.parse(inputPath).base;

    const filenameCheck = filenameHandler.checkFilenameAgainstHeader(filenameHandler.SYNC, inputFilename, header.icmt.comment, header.iart.artist);

    if (filenameCheck.success === false) return filenameCheck;

    /* Extract original timestamp */

    const originalTimestamp = filenameCheck.originalTimestamp;

    /* Generate output filename */

    const outputFilename = (prefix === '' ? '' : prefix + '_') + inputFilename.replace('.WAV', '_SYNC.WAV');

    /* Determine settings from the input file */

    const inputFileDataSize = header.data.size;

    const sampleRate = header.wavFormat.samplesPerSecond;

    const sampleInterval = MICROSECONDS_IN_SECOND / sampleRate;

    /* Read the CSV file contents */

    const csvPath = inputPath.replace('.WAV', '.CSV');

    try {

        fs.existsSync(inputPath);

    } catch (e) {

        return {
            success: false,
            error: 'Could not find the input CSV file.'
        };

    }

    const result = csvReader.readFile(csvPath, ['PPS_NUMBER', 'AUDIOMOTH_TIME', 'SAMPLES', 'TOTAL_SAMPLES', 'TIMER_COUNT', 'TIME_TO_NEXT_SAMPLE', 'BUFFERS_FILLED', 'BUFFERS_WRITTEN'], [Number, String, Number, Number, Number, Number, Number, Number]);

    if (result.success === false) {

        return {
            success: false,
            error: result.error
        };

    }

    /* Extract data */

    const PPS_NUMBER = result.data.PPS_NUMBER;
    const AUDIOMOTH_TIME = result.data.AUDIOMOTH_TIME;
    const TOTAL_SAMPLES = result.data.TOTAL_SAMPLES;
    const TIMER_COUNT = result.data.TIMER_COUNT;
    const BUFFERS_FILLED = result.data.BUFFERS_FILLED;
    const BUFFERS_WRITTEN = result.data.BUFFERS_WRITTEN;

    let numberOfRows = 0;

    let dataOkay = PPS_NUMBER && PPS_NUMBER.length && PPS_NUMBER.length > 1;

    if (dataOkay === false) {

        return {
            success: false,
            error: 'Input CSV does not contain at least two PPS events.'
        };

    }

    if (dataOkay) numberOfRows = PPS_NUMBER.length;

    dataOkay = dataOkay && (AUDIOMOTH_TIME && AUDIOMOTH_TIME.length && AUDIOMOTH_TIME.length === numberOfRows);
    dataOkay = dataOkay && (TOTAL_SAMPLES && TOTAL_SAMPLES.length && TOTAL_SAMPLES.length === numberOfRows);
    dataOkay = dataOkay && (TIMER_COUNT && TIMER_COUNT.length && TIMER_COUNT.length === numberOfRows);
    dataOkay = dataOkay && (BUFFERS_FILLED && BUFFERS_FILLED.length && BUFFERS_FILLED.length === numberOfRows);
    dataOkay = dataOkay && (BUFFERS_WRITTEN && BUFFERS_WRITTEN.length && BUFFERS_WRITTEN.length === numberOfRows);

    if (dataOkay === false) {

        return {
            success: false,
            error: 'Input CSV file does not contain appropriate data.'
        };

    }

    /* Check the first timestamp */

    let dateOkay = true;

    try {

        const fileTimestamp = Date.parse(inputFilename.substring(0, 4) + '-' + inputFilename.substring(4, 6) + '-' + inputFilename.substring(6, 8) + 'T' + inputFilename.substring(9, 11) + ':' + inputFilename.substring(11, 13) + ':' + inputFilename.substring(13, 15) + '.000Z');

        const firstTimestamp = Date.parse(AUDIOMOTH_TIME[0] + 'Z');

        const difference = Math.abs(fileTimestamp - firstTimestamp);

        if (difference > MAXIMUM_ALLOWABLE_TIMESTAMP_DIFFERENCE) dateOkay = false;

    } catch (e) {

        dateOkay = false;

    }

    if (dateOkay === false) {

        return {
            success: false,
            error: 'Input CSV file timestamp does not match input WAV file.'
        };

    }

    /* Check for missing buffers */

    for (let i = 0; i < numberOfRows; i += 1) {

        if (BUFFERS_FILLED[i] - BUFFERS_WRITTEN[i] >= NUMBER_OF_BUFFERS) {

            return {
                success: false,
                error: 'Input CSV file shows evidence of recording buffer overflow.'
            };

        }

    }

    /* Determine the sample parameters */

    const overSampleRate = 2 ** Math.floor(Math.log2(MAXIMUM_REFERENCE_SAMPLE_RATE / sampleRate));

    const clockTicksBetweenSamples = CLOCK_FREQUENCY / sampleRate;

    const clockTicksToCompleteSample = 2 + CLOCK_DIVIDER * (2 + overSampleRate * (ACQUISITION_CYCLES + CONVERSION_CYCLES));

    /* Calculate the time to next sample */

    const TIME_TO_NEXT_SAMPLE = new Array(numberOfRows);

    for (let i = 0; i < numberOfRows; i += 1) {

        if (TIMER_COUNT[i] <= clockTicksToCompleteSample) {

            TIME_TO_NEXT_SAMPLE[i] = (clockTicksToCompleteSample - TIMER_COUNT[i]) / CLOCK_FREQUENCY * MICROSECONDS_IN_SECOND;

        } else {

            TIME_TO_NEXT_SAMPLE[i] = (clockTicksBetweenSamples + clockTicksToCompleteSample - TIMER_COUNT[i]) / CLOCK_FREQUENCY * MICROSECONDS_IN_SECOND;

        }

    }

    /* Calculate the interval between PPS events and the number of samples */

    let autoResolveText = '';

    let missedPPSEvent = false;

    let misalignedPPSEvent = false;

    const intervals = [];

    let numberOfIntervals = 0;

    let cumulativeTimeInterval = 0;

    let currentIndex = 0;

    let currentSamples = TOTAL_SAMPLES[0];

    let currentDate = Date.parse(AUDIOMOTH_TIME[0] + 'Z');

    let sampleRateTotal = 0;

    let sampleRateCount = 0;

    try {

        for (let i = 1; i < numberOfRows; i += 1) {

            /* Read next time and sample values */

            const nextIndex = i;

            const nextSamples = TOTAL_SAMPLES[i];

            const nextDate = Date.parse(AUDIOMOTH_TIME[i] + 'Z');

            /* Calculate differences */

            const samples = nextSamples - currentSamples;

            const timeInterval = nextDate - currentDate;

            const roundedTimeInterval = Math.round(timeInterval / MILLISECONDS_IN_SECOND);

            /* Calculate maximum allowable error */

            const targetSampleRate = sampleRateCount === 0 ? sampleRate : sampleRateTotal / sampleRateCount;

            const maximumAllowableTimeError = Math.ceil(MAX_LFXO_ERROR * roundedTimeInterval * MILLISECONDS_IN_SECOND);

            const maximumAllowableSampleRateError = Math.ceil((sampleRateCount === 0 ? MAX_HFXO_ERROR_ABSOLUTE : MAX_HFXO_ERROR_RELATIVE) * (sampleRateCount === 0 ? sampleRate : targetSampleRate) * roundedTimeInterval);

            /* Check this PPS event */

            if (roundedTimeInterval > 0 && Math.abs(timeInterval - roundedTimeInterval * MILLISECONDS_IN_SECOND) <= maximumAllowableTimeError && Math.abs(samples - roundedTimeInterval * targetSampleRate) <= maximumAllowableSampleRateError) {

                /* Update average sample rate */

                sampleRateTotal += samples;

                sampleRateCount += roundedTimeInterval;

                /* Add the interval */

                const interval = {
                    index: numberOfIntervals,
                    numberOfSamples: samples,
                    startPPSIndex: currentIndex,
                    endPPSIndex: nextIndex,
                    timeInterval: roundedTimeInterval,
                    cumulativeTimeInterval: cumulativeTimeInterval,
                    firstSampleGap: TIME_TO_NEXT_SAMPLE[currentIndex],
                    lastSampleGap: sampleInterval - TIME_TO_NEXT_SAMPLE[nextIndex]
                };

                intervals.push(interval);

                numberOfIntervals += 1;

                cumulativeTimeInterval += roundedTimeInterval;

                /* Set the flag and stop if autoresolve is not enabled */

                if (roundedTimeInterval > 1) {

                    missedPPSEvent = true;

                    if (autoResolve === false) {

                        return {
                            success: false,
                            error: 'Input CSV file has a missing PPS event.'
                        };

                    }

                }

                /* Update for next interval */

                currentIndex = nextIndex;

                currentSamples = nextSamples;

                currentDate = nextDate;

            } else {

                /* Set the flag and stop if autoresolve is not enabled */

                misalignedPPSEvent = true;

                if (autoResolve === false) {

                    return {
                        success: false,
                        error: 'Input CSV file has a misaligned PPS event.'
                    };

                }

            }

        }

    } catch (e) {

        return {
            success: false,
            error: 'Could not parse PPS events in input CSV file.'
        };

    }

    /* Check at least one interval */

    if (numberOfIntervals === 0) {

        return {
            success: false,
            error: 'Input CSV file does not contain any valid intervals between PPS events.'
        };

    }

    /* Function to calculate and set sample rate */

    function calculateSampleRate (interval) {

        interval.sampleRate = (interval.numberOfSamples - 1) * MICROSECONDS_IN_SECOND / (interval.timeInterval * MICROSECONDS_IN_SECOND - interval.firstSampleGap - interval.lastSampleGap);

    }

    /* Calculate the first and last sample times */

    for (let i = 0; i < numberOfIntervals; i += 1) {

        calculateSampleRate(intervals[i]);

    }

    /* Calculate the average sample rate */

    let totalNumberOfSeconds = 0;

    let totalNumberOfSamples = 0;

    for (let i = 0; i < numberOfIntervals; i += 1) {

        totalNumberOfSeconds += intervals[i].timeInterval;

        totalNumberOfSamples += intervals[i].numberOfSamples;

    }

    const averageSampleRate = totalNumberOfSamples / totalNumberOfSeconds;

    /* Generate report when auto-resolving issues */

    function formatIntervalTime (interval) {

        const startTime = new Date(originalTimestamp.valueOf() + interval.cumulativeTimeInterval * MILLISECONDS_IN_SECOND);

        const endTime = new Date(startTime.valueOf() + interval.timeInterval * MILLISECONDS_IN_SECOND);

        let string = digits(startTime.getUTCHours(), 2) + ':' + digits(startTime.getUTCMinutes(), 2) + ':' + digits(startTime.getUTCSeconds(), 2);

        string += ' - ' + digits(endTime.getUTCHours(), 2) + ':' + digits(endTime.getUTCMinutes(), 2) + ':' + digits(endTime.getUTCSeconds(), 2);

        return string;

    }

    if (missedPPSEvent) {

        autoResolveText += 'MISSED PPS EVENTS\n-----------------\n';

        for (let i = 0; i < numberOfIntervals; i += 1) {

            if (intervals[i].timeInterval > 1) {

                autoResolveText += formatIntervalTime(intervals[i]) + ': Interval from PPS number ' + intervals[i].startPPSIndex + ' to ' + intervals[i].endPPSIndex + ' has a duration of ' + intervals[i].timeInterval + ' seconds.\n';

            }

        }

    }

    if (missedPPSEvent && misalignedPPSEvent) autoResolveText += '\n';

    if (misalignedPPSEvent) {

        autoResolveText += 'MISALIGNED PPS EVENTS\n---------------------\n';

        for (let i = 0; i < numberOfIntervals; i += 1) {

            if (intervals[i].startPPSIndex !== intervals[i].endPPSIndex - 1) {

                autoResolveText += formatIntervalTime(intervals[i]) + ': Interval from PPS number ' + intervals[i].startPPSIndex + ' to ' + intervals[i].endPPSIndex + ' contains misaligned PPS events.\n';

            }

        }

    }

    /* Output the debug file */

    if (DEBUG) {

        const fo = fs.openSync(path.join(outputPath, outputFilename.replace('.WAV', '_UNFIXED.CSV')), 'w');

        fs.writeSync(fo, 'INDEX,PPS_START_INDEX,PPS_END_INDEX,INTERVAL,SAMPLES,SAMPLE_RATE,TIME_TO_FIRST_SAMPLE,TIME_FROM_LAST_SAMPLE\n');

        for (let i = 0; i < numberOfIntervals; i += 1) {

            const interval = intervals[i];

            fs.writeSync(fo, interval.index + ',' + interval.startPPSIndex + ',' + interval.endPPSIndex + ',' + interval.timeInterval + ',' + interval.numberOfSamples + ',' + interval.sampleRate.toFixed(4) + ',' + interval.firstSampleGap.toFixed(2) + ',' + interval.lastSampleGap.toFixed(2) + '\n');

        }

        fs.closeSync(fo);

    }

    /* Fix the PPS events */

    let debugText = '';

    if (FIX_PPS_EVENTS) {

        for (let i = 0; i < numberOfIntervals - 1; i += 1) {

            const interval = intervals[i];

            const nextInterval = intervals[i + 1];

            if (interval.lastSampleGap < MAXIMUM_ALLOWABLE_PPS_OFFSET && Math.round(interval.sampleRate - averageSampleRate) === -1 && Math.round(nextInterval.sampleRate - averageSampleRate) === 1) {

                /* Sample seems to occur just before PPS event, however, it actually occurs after the PPS event */

                debugText += 'Fixed incorrect order of sample and PPS event at interval ' + i + '.\n';

                interval.lastSampleGap = sampleInterval;

                calculateSampleRate(interval);

                nextInterval.firstSampleGap = 0;

                calculateSampleRate(nextInterval);

            }

        }

        if (sampleRate === MAXIMUM_ALLOWABLE_SAMPLE_RATE) {

            /* Check first interval */

            const interval = intervals[0];

            if (Math.round(interval.sampleRate - averageSampleRate) === 1) {

                /* There seems to be an extra sample in the first interval */

                debugText += 'Fixed extra sample due to close PPS event at interval 0.\n';

                interval.firstSampleGap -= sampleInterval;

                calculateSampleRate(interval);

            }

            /* Check all intervals */

            for (let i = 0; i < numberOfIntervals - 1; i += 1) {

                const interval = intervals[i];

                const nextInterval = intervals[i + 1];

                if (interval.lastSampleGap < MAXIMUM_ALLOWABLE_PPS_OFFSET && Math.round(interval.sampleRate - averageSampleRate) === -1 && Math.round(nextInterval.sampleRate - averageSampleRate) === 0) {

                    /* Sample seems to occur just before PPS event, however, it actually occurs after the PPS event and causes the first sample to be missed */

                    debugText += 'Fixed incorrect order of sample and PPS event, and missed sample, at interval ' + i + '.\n';

                    interval.lastSampleGap = sampleInterval;

                    calculateSampleRate(interval);

                    nextInterval.firstSampleGap = sampleInterval;

                    calculateSampleRate(nextInterval);

                }

            }

            for (let i = 0; i < numberOfIntervals; i += 1) {

                const interval = intervals[i];

                if (Math.round(interval.sampleRate - averageSampleRate) === -1) {

                    /* There seems to be a missing sample */

                    debugText += 'Fixed missing sample due to close PPS event at interval ' + i + '.\n';

                    interval.firstSampleGap += sampleInterval;

                    calculateSampleRate(interval);

                }

            }

        }

    }

    /* Output the debug file */

    if (DEBUG) {

        let fo = fs.openSync(path.join(outputPath, outputFilename.replace('.WAV', '_DEBUG.TXT')), 'w');

        if (debugText.length > 0) {

            fs.writeSync(fo, debugText);

        } else {

            fs.writeSync(fo, 'No corrections required.');

        }

        fs.closeSync(fo);

        fo = fs.openSync(path.join(outputPath, outputFilename.replace('.WAV', '_FIXED.CSV')), 'w');

        fs.writeSync(fo, 'INDEX,PPS_START_INDEX,PPS_END_INDEX,INTERVAL,SAMPLES,SAMPLE_RATE,TIME_TO_FIRST_SAMPLE,TIME_FROM_LAST_SAMPLE\n');

        for (let i = 0; i < numberOfIntervals; i += 1) {

            const interval = intervals[i];

            fs.writeSync(fo, interval.index + ',' + interval.startPPSIndex + ',' + interval.endPPSIndex + ',' + interval.timeInterval + ',' + interval.numberOfSamples + ',' + interval.sampleRate.toFixed(4) + ',' + interval.firstSampleGap.toFixed(2) + ',' + interval.lastSampleGap.toFixed(2) + '\n');

        }

        fs.closeSync(fo);

    }

    /* Check first interval for early sample (resulting from correction at MAXIMUM_ALLOWABLE_SAMPLE_RATE */

    let firstSampleIsBeforeFirstInterval = intervals[0].firstSampleGap < 0;

    /* Adjust interval times by half the conversion period */

    if (ALIGN_SAMPLES) {

        const lastAquisitionEnds = 1 + CLOCK_DIVIDER * (CONVERSION_CYCLES + 1);

        const firstAquisitionStarts = clockTicksToCompleteSample - 1 - CLOCK_DIVIDER;

        const timeOffset = MICROSECONDS_IN_SECOND * (lastAquisitionEnds + firstAquisitionStarts) / 2 / CLOCK_FREQUENCY;

        for (let i = 0; i < numberOfIntervals; i += 1) {

            const interval = intervals[i];

            interval.firstSampleGap -= timeOffset;

            interval.lastSampleGap += timeOffset;

            if (interval.firstSampleGap < 0) {

                interval.numberOfSamples -= 1;

                interval.firstSampleGap += sampleInterval;

                if (i === 0) {

                    firstSampleIsBeforeFirstInterval = true;

                } else {

                    intervals[i - 1].numberOfSamples += 1;

                    intervals[i - 1].lastSampleGap = sampleInterval - interval.firstSampleGap;

                }

            }

        }

    }

    /* Recalculate sample rates */

    for (let i = 0; i < numberOfIntervals; i += 1) {

        const interval = intervals[i];

        calculateSampleRate(interval);

    }

    /* Output the debug file */

    if (DEBUG) {

        const fo = fs.openSync(path.join(outputPath, outputFilename.replace('.WAV', '_ALIGNED.CSV')), 'w');

        fs.writeSync(fo, 'INDEX,PPS_START_INDEX,PPS_END_INDEX,INTERVAL,SAMPLES,SAMPLE_RATE,TIME_TO_FIRST_SAMPLE,TIME_FROM_LAST_SAMPLE\n');

        for (let i = 0; i < numberOfIntervals; i += 1) {

            const interval = intervals[i];

            fs.writeSync(fo, interval.index + ',' + interval.startPPSIndex + ',' + interval.endPPSIndex + ',' + interval.timeInterval + ',' + interval.numberOfSamples + ',' + interval.sampleRate.toFixed(4) + ',' + interval.firstSampleGap.toFixed(2) + ',' + interval.lastSampleGap.toFixed(2) + '\n');

        }

        fs.closeSync(fo);

    }

    /* Check calculated sample rates */

    let unusualSampleRate = false;

    for (let i = 0; i < numberOfIntervals; i += 1) {

        const interval = intervals[i];

        const sampleRateDifference = Math.round(interval.sampleRate - averageSampleRate);

        if (sampleRateDifference !== 0) {

            if (unusualSampleRate === false) {

                if (missedPPSEvent || misalignedPPSEvent) autoResolveText += '\n';

                autoResolveText += 'UNUSUAL SAMPLE RATE\n-------------------\n';

            }

            unusualSampleRate = true;

            autoResolveText += formatIntervalTime(interval) + ': Interval from PPS number ' + interval.startPPSIndex + ' to ' + interval.endPPSIndex + ' has ';

            if (sampleRateDifference > 1) {

                autoResolveText += sampleRateDifference + ' extra samples';

            } else if (sampleRateDifference === 1) {

                autoResolveText += '1 extra sample';

            } else if (sampleRateDifference === -1) {

                autoResolveText += '1 less sample';

            } else if (sampleRateDifference < -1) {

                autoResolveText += (-sampleRateDifference) + ' less samples';

            }

            autoResolveText += ' per second.\n';

        }

    }

    if (unusualSampleRate && autoResolve === false) {

        return {
            success: false,
            error: 'Input CSV file has an unusual sample count between PPS events.'
        };

    }

    if (missedPPSEvent || misalignedPPSEvent || unusualSampleRate) {

        const fo = fs.openSync(path.join(outputPath, outputFilename.replace('.WAV', '.TXT')), 'w');

        fs.writeSync(fo, autoResolveText);

        fs.closeSync(fo);

    }

    /* Shift due to missing sample at highest sample rate */

    if (sampleRate === MAXIMUM_ALLOWABLE_SAMPLE_RATE) {

        for (let i = 0; i < numberOfIntervals; i += 1) {

            const interval = intervals[i];

            interval.firstSampleGap += sampleInterval;

            calculateSampleRate(interval);

        }

    }

    /* Calculate output parameters */

    let targetSampleRate = sampleRate;

    const maximumNumberOfSamplesToRead = Math.floor(inputFileDataSize / NUMBER_OF_BYTES_IN_SAMPLE);

    let numberOfSamplesToWrite = maximumNumberOfSamplesToRead;

    /* Check if resample required */

    const resampleRequired = (typeof resampleRate === 'number') && sampleRate !== resampleRate;

    if (resampleRequired) {

        targetSampleRate = resampleRate;

        /* Calculate the number of samples to read and write */

        const gcd = greatestCommonDivider(sampleRate / HERTZ_IN_KILOHERTZ, targetSampleRate / HERTZ_IN_KILOHERTZ);

        const divider = sampleRate / HERTZ_IN_KILOHERTZ / gcd;

        const multiplier = targetSampleRate / HERTZ_IN_KILOHERTZ / gcd;

        numberOfSamplesToWrite = Math.floor(numberOfSamplesToWrite / divider) * multiplier;

    }

    /* Check the maximum file size */

    const calculatedFileSize = header.size + numberOfSamplesToWrite * NUMBER_OF_BYTES_IN_SAMPLE;

    if (calculatedFileSize > UINT32_MAX) {

        return {
            success: false,
            error: 'Generated WAV file would exceed maximum WAV file size.'
        };

    }

    /* Read the GUANO if present */

    let guano;

    if (header.data.size + header.size < fileSize) {

        const numberOfBytes = Math.min(fileSize - header.size - header.data.size, FILE_BUFFER_SIZE);

        try {

            /* Read end of file into the buffer */

            const numberOfBytesRead = fs.readSync(fi, headerBuffer, 0, numberOfBytes, header.data.size + header.size);

            if (numberOfBytesRead === numberOfBytes) {

                /* Parse the GUANO header */

                const guanoCheck = guanoHandler.readGuano(headerBuffer, numberOfBytes);

                if (guanoCheck.success) {

                    guano = guanoCheck.guano;

                }

            }

        } catch (e) {

            guano = null;

        }

    }

    /* Update the header */

    wavHandler.updateSampleRate(header, targetSampleRate);

    wavHandler.updateSizes(header, guano, numberOfSamplesToWrite * NUMBER_OF_BYTES_IN_SAMPLE);

    wavHandler.writeHeader(headerBuffer, header);

    /* Allocate space for input and output */

    let maximumTimeInterval = 0;

    for (let i = 0; i < numberOfIntervals; i += 1) {

        const interval = intervals[i];

        maximumTimeInterval = Math.max(maximumTimeInterval, interval.timeInterval);

    }

    const syncInputBuffer = Buffer.alloc(FILE_BUFFER_SIZE);

    const syncOutputBuffer = Buffer.alloc(FILE_BUFFER_SIZE);

    /* Open the output file and write the header */

    const fo = fs.openSync(path.join(outputPath, outputFilename), 'w');

    fs.writeSync(fo, headerBuffer, 0, header.size, null);

    /* Reset the input file to end of header */

    fs.readSync(fi, headerBuffer, 0, header.size, null);

    /* Read the first file buffer */

    fs.readSync(fi, syncInputBuffer, 0, FILE_BUFFER_SIZE, null);

    /* Set up the counters */

    let progress = 0;

    let inputBufferIndex = 0;

    let outputBufferIndex = 0;

    let numberOfSamplesRead = 0;

    let numberOfSamplesWritten = 0;

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

    /* Set up initial values */

    let nextSampleValue = readSampleValue();

    let previousSampleValue = nextSampleValue;

    totalNumberOfSamples = firstSampleIsBeforeFirstInterval ? 1 : 0;

    if (firstSampleIsBeforeFirstInterval) nextSampleValue = readSampleValue();

    /* Iterate through intervals */

    for (let i = 0; i < numberOfIntervals; i += 1) {

        const interval = intervals[i];

        totalNumberOfSamples += interval.numberOfSamples;

        let nextSampleOffset = interval.firstSampleGap / MICROSECONDS_IN_SECOND;

        let previousSampleOffset = nextSampleOffset - sampleInterval / MICROSECONDS_IN_SECOND;

        const timeInterval = interval.timeInterval;

        const numberOfSamples = timeInterval * targetSampleRate;

        for (let j = 0; j < numberOfSamples; j += 1) {

            const currentOffset = j / numberOfSamples * timeInterval;

            while (currentOffset > nextSampleOffset) {

                /* Update previous sample values */

                previousSampleOffset = nextSampleOffset;

                previousSampleValue = nextSampleValue;

                /* Read the next sample value */

                if (numberOfSamplesRead < maximumNumberOfSamplesToRead && numberOfSamplesRead < totalNumberOfSamples + 1) {

                    nextSampleValue = readSampleValue();

                }

                /* Update the next sample offset */

                nextSampleOffset += 1 / interval.sampleRate;

            }

            /* Calculate the interpolated sample value */

            const interpolatedSampleValue = Math.round(previousSampleValue + (currentOffset - previousSampleOffset) / (nextSampleOffset - previousSampleOffset) * (nextSampleValue - previousSampleValue));

            /* Write the sample value */

            if (numberOfSamplesWritten < numberOfSamplesToWrite) {

                writeSampleValue(interpolatedSampleValue);

            }

        }

        /* Read on to next sample */

        while (numberOfSamplesRead < maximumNumberOfSamplesToRead && numberOfSamplesRead < totalNumberOfSamples + 1) {

            previousSampleValue = nextSampleValue;

            nextSampleValue = readSampleValue();

        }

        /* Callback with progress */

        const newProgress = Math.round(100 * numberOfSamplesWritten / numberOfSamplesToWrite);

        if (newProgress > progress) {

            if (callback) callback(newProgress);

            progress = newProgress;

        }

    }

    /* Write the remaining output values */

    let currentOffset = 0;

    const interval = intervals[numberOfIntervals - 1];

    let previousSampleOffset = -interval.lastSampleGap / MICROSECONDS_IN_SECOND;

    let nextSampleOffset = previousSampleOffset + 1 / interval.sampleRate;

    while (numberOfSamplesWritten < numberOfSamplesToWrite) {

        while (currentOffset > nextSampleOffset) {

            /* Update previous sample values */

            previousSampleOffset = nextSampleOffset;

            previousSampleValue = nextSampleValue;

            /* Read the next sample value */

            if (numberOfSamplesRead < maximumNumberOfSamplesToRead) {

                nextSampleValue = readSampleValue();

            }

            /* Update the next sample offset */

            nextSampleOffset += 1 / interval.sampleRate;

        }

        /* Calculate the interpolated sample value */

        const interpolatedSampleValue = Math.round(previousSampleValue + (currentOffset - previousSampleOffset) / (nextSampleOffset - previousSampleOffset) * (nextSampleValue - previousSampleValue));

        /* Write the sample value */

        if (numberOfSamplesWritten < numberOfSamplesToWrite) {

            writeSampleValue(interpolatedSampleValue);

        }

        /* Update current offset */

        currentOffset += 1 / targetSampleRate;

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

/* Export sync */

exports.sync = sync;
