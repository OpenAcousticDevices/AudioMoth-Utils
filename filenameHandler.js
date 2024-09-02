/****************************************************************************
 * filenameHandler.js
 * openacousticdevices.info
 * September 2024
 *****************************************************************************/

'use strict';

/* Operation types */

const SPLIT = 0;
const DOWNSAMPLE = 1;
const EXPAND = 2;
const SYNC = 3;

/* Filename and dates regexes */

const regexes = [/^([A-Za-z-_0-9]+_)?(\d{8}_\d{6})(_SYNC)?\.WAV$/,
    /^([A-Za-z-_0-9]+_)?(\d{8}_\d{6})(_SYNC)?\.WAV$/,
    /^([0-9A-F]{16}_)?((\d{8}_)?\d{6})T\.WAV$/,
    /^([0-9A-F]{16}_)?(\d{8}_\d{6})\.WAV$/
];

const DATE_REGEX = /Recorded at (\d\d):(\d\d):(\d\d) (\d\d)\/(\d\d)\/(\d\d\d\d)/;

/* Public functions */

function getFilenameRegex (type) {

    return regexes[type];

}

function checkFilenameAgainstHeader (type, filename, comment, deviceID) {

    /* Match with filename regex */

    const matches = filename.match(regexes[type]);

    if (!matches) {

        return {
            success: false,
            error: 'File name is not valid.'
        };

    }

    /* Extract filename time string */

    const originalTimestring = matches[2];

    /* Check existing prefix */

    const existingPrefix = matches[1] ? matches[1] : '';

    if (type === EXPAND || type === SYNC) {

        if (matches[1]) {

            const prefix = matches[1].substring(0, matches[1].length - 1);

            if ('AudioMoth ' + prefix !== deviceID) {

                return {
                    success: false,
                    error: 'Device ID in the input WAV file header does not match the file name.'
                };

            }

        }

    }

    /* Check existing postfix */

    const existingPostfix = (type === SPLIT || type === DOWNSAMPLE) && matches[3] ? matches[3] : '';

    /* Check time against comments field */

    let originalTimestamp = null;

    if (type === SPLIT || type === EXPAND || type === SYNC) {

        if (DATE_REGEX.test(comment) === false) {

            return {
                success: false,
                error: 'Cannot find timestamp in the input WAV file header.'
            };

        }

        const dateMatches = DATE_REGEX.exec(comment);

        const expectedTimestring = type === EXPAND && !matches[3] ? dateMatches[1] + dateMatches[2] + dateMatches[3] : dateMatches[6] + dateMatches[5] + dateMatches[4] + '_' + dateMatches[1] + dateMatches[2] + dateMatches[3];

        if (expectedTimestring !== originalTimestring) {

            return {
                success: false,
                error: 'Timestamp in the input WAV file header does not match the file name.'
            };

        }

        originalTimestamp = Date.UTC(dateMatches[6], dateMatches[5] - 1, dateMatches[4], dateMatches[1], dateMatches[2], dateMatches[3]);

    }

    /* Return success */

    return {
        success: true,
        existingPrefix: existingPrefix,
        existingPostfix: existingPostfix,
        originalTimestamp: originalTimestamp,
        originalTimestring: originalTimestring
    };

}

/* Export functions */

exports.getFilenameRegex = getFilenameRegex;
exports.checkFilenameAgainstHeader = checkFilenameAgainstHeader;

exports.SPLIT = SPLIT;
exports.DOWNSAMPLE = DOWNSAMPLE;
exports.EXPAND = EXPAND;
exports.SYNC = SYNC;
