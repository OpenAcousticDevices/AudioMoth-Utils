/****************************************************************************
 * audiomoth-utils.js
 * openacousticdevices.info
 * February 2021
 *****************************************************************************/

const downsampler = require('./downsampler.js');
const expander = require('./expander.js');
const splitter = require('./splitter.js');

exports.downsample = downsampler.downsample;
exports.expand = expander.expand;
exports.split = splitter.split;
