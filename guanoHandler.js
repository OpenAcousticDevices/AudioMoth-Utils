/****************************************************************************
 * guanoHandler.js
 * openacousticdevices.info
 * February 2024
 *****************************************************************************/

'use strict';

/* RIFF constants */

const UINT32_LENGTH = 4;
const RIFF_ID_LENGTH = 4;

/* RIFF component read functions */

function readString (state, length) {

    if (state.buffer.length - state.index < length) throw new Error('RIFF component exceeded buffer length.');

    const buffer = state.buffer.subarray(state.index, state.index + length);

    state.index += length;

    return {
        contents: buffer.toString('utf8'),
        buffer: Buffer.from(buffer)
    };

}

function readUInt32LE (state) {

    if (state.buffer.length - state.index < UINT32_LENGTH) throw new Error('RIFF component exceeded buffer length.');

    const result = state.buffer.readUInt32LE(state.index);

    state.index += UINT32_LENGTH;
    
    return result;

}

function readChunk (state, id) {

    const response = readString(state, RIFF_ID_LENGTH);

    if (response.contents !== id) throw new Error('Could not find ' + id.replace(' ', '') + ' chunk ID.');

    return {
        id: response.contents,
        size: readUInt32LE(state)
    };

}

/* RIFF component write functions */

function writeString (state, string, length) {

    const maximumWriteLength = Math.min(string.length, length);
    
    state.buffer.fill(0, state.index, state.index + length);
    
    state.buffer.write(string, state.index, maximumWriteLength, 'utf8');
    
    state.index += length;

}

function writeBuffer (state, buffer) {

    buffer.copy(state.buffer, state.index, 0, buffer.length);
    
    state.index += buffer.length;

}

function writeUInt32LE (state, value) {

    state.buffer.writeUInt32LE(value, state.index);
    
    state.index += UINT32_LENGTH;

}

function writeChunk (state, chunk) {

    writeString(state, chunk.id, RIFF_ID_LENGTH);
    
    writeUInt32LE(state, chunk.size);

}

/* GUANO read and write functions */

function readGuano (buffer, bufferSize) {

    const guano = {};

    const state = {buffer: buffer, index: 0};

    try {

        /* Read RIFF chunk */

        guano.guan = readChunk(state, 'guan');

        if (guano.guan.size + RIFF_ID_LENGTH + UINT32_LENGTH > bufferSize) {

            return {
                success: false,
                error: 'GUANO size exceeds buffer size.'
            };

        }

        /* Read the contents */

        const response = readString(state, guano.guan.size);
        
        guano.contents = response.contents;

        guano.buffer = response.buffer;

        guano.size = guano.guan.size + RIFF_ID_LENGTH + UINT32_LENGTH;

        /* Success */

        return {
            guano: guano,
            success: true,
            error: null
        };

    } catch (e) {

        /* GUANO has exceed buffer length */

        return {
            success: false,
            error: e.message
        };

    }

}

function writeGuano (buffer, guano) {

    const state = {buffer: buffer, index: 0};

    writeChunk(state, guano.guan);

    writeBuffer(state, guano.buffer);

    return buffer;

}

/* Functions to update GUANO */

function updateContents (guano, contents) {

    guano.buffer = Buffer.from(contents, 'utf8');

    guano.contents = contents;

    guano.guan.size = guano.buffer.length;

    guano.size = RIFF_ID_LENGTH + UINT32_LENGTH + guano.guan.size;

}

/* Exports */

exports.writeGuano = writeGuano;
exports.readGuano = readGuano;
exports.updateContents = updateContents;