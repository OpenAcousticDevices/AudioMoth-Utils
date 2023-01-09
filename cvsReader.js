/****************************************************************************
 * cvsReader.js
 * openacousticdevices.info
 * June 2020
 *****************************************************************************/

'use strict';

const fs = require('fs');
const path = require('path');

const FILE_BUFFER_SIZE = 32 * 1024;

const fileBuffer = Buffer.alloc(FILE_BUFFER_SIZE);

/* Function to handle an individual line */

function parseLine(columnNames, tokens, parseFunctions, tokenMap, data) {

    for (let i = 0; i < columnNames.length; i += 1) {

        const name = columnNames[i];

        const index = tokenMap[name];

        if (typeof(index) === 'number') data[name].push(parseFunctions[i](tokens[index]));

    }

}

/* Function to read the file */

function readFile (inputPath, columnNames, parseFunctions) {

    var fi, fileSize, data, tokenMap, numberOfColumns;

    /* Check arguments */

    if (columnNames.length === 0 || parseFunctions.length === 0 || columnNames.length !== parseFunctions.length) {

        return {
            success: false,
            error: 'Arguments are incorrect.'
        };

    }

    /* Open input file */

    try {

        fi = fs.openSync(inputPath, 'r');

    } catch (e) {

        return {
            success: false,
            error: 'Could not open input CSV file.'
        };

    }

    try {

        fileSize = fs.statSync(inputPath).size;

    } catch (e) {

        return {
            success: false,
            error: 'Could not read input CSV file size.'
        };

    }

    if (fileSize === 0) {

        return {
            success: false,
            error: 'Input CSV file has zero size.'
        };

    }

    /* Read first line */

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

                const tokens = line.split(',');

                if (tokenMap) {

                    if (tokens.length === numberOfColumns) parseLine(columnNames, tokens, parseFunctions, tokenMap, data);

                } else {

                    data = {};

                    tokenMap = {};

                    numberOfColumns = tokens.length;

                    for (let i = 0; i <columnNames.length; i += 1) {

                        const name = columnNames[i];

                        for (let j = 0; j < tokens.length; j += 1) {

                            if (name === tokens[j] && tokenMap[name] == undefined) {

                                tokenMap[name] = j;

                                data[name] = [];
                                
                            }

                        }

                    }

                }

            }

            numberOfBytesRead += numberOfBytes;

        }

        /* Handle last line */

        const tokens = buffer.split(',');

        if (tokens && tokens.length === numberOfColumns) parseLine(columnNames, tokens, parseFunctions, tokenMap, data);

    } catch (e) {

        return {
            success: false,
            error: 'Something went wrong parsing CSV file.'
        };

    }

    /* Return data */

    return {
        success: true,
        data: data
    };

}

/* Exports */

exports.readFile = readFile;