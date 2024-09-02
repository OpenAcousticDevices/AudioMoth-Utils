/****************************************************************************
 * audiomoth-utils.js
 * openacousticdevices.info
 * February 2021
 *****************************************************************************/

const filenameHandler = require('./filenameHandler.js');
const downsampler = require('./downsampler.js');
const summariser = require('./summariser.js');
const expander = require('./expander.js');
const splitter = require('./splitter.js');
const syncer = require('./syncer.js');

exports.downsample = downsampler.downsample;

exports.summariser = {};
exports.summariser.initialise = summariser.initialise;
exports.summariser.summarise = summariser.summarise;
exports.summariser.finalise = summariser.finalise;

exports.expand = expander.expand;
exports.split = splitter.split;
exports.sync = syncer.sync;

exports.getFilenameRegex = filenameHandler.getFilenameRegex;
exports.SPLIT = filenameHandler.SPLIT;
exports.DOWNSAMPLE = filenameHandler.DOWNSAMPLE;
exports.EXPAND = filenameHandler.EXPAND;
exports.SYNC = filenameHandler.SYNC;
