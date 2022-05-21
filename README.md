# AudioMoth-Utils #
A Node.js library for performing various tasks involving AudioMoth and files created by the AudioMoth. The module is hosted on npm under the name 'audiomoth-utils'.

### Usage ###

The module should be imported as normal:

```javascript
var audiomothUtils = require('audiomoth-utils');
```

#### Expanding and Splitting ####

Expand an AudioMoth T.WAV recording (a recording with amplitude thresholding or frequency triggering applied):

```javascript
audiomothUtils.expand(inputPath, outputPath, prefix, expansionType, maximumFileDuration, generateSilentFiles, alignToSecondTransitions, (progress) => {
    console.log(progress + '% completed');
}));
```

To be identified as an AudioMoth T.WAV file, a recording must fit the regex `/^(\d\d\d\d\d\d\d\d_)?\d\d\d\d\d\dT.WAV$/` and have the correct WAV header comment.

---
Split an AudioMoth WAV file into a number of smaller files:

```javascript
audiomothUtils.split(inputPath, outputPath, prefix, maximumFileDuration, (progress) => {
    console.log(progress + '% completed');
}));
```

To be identified as an AudioMoth WAV file, a recording must fit the regex `/^(\d\d\d\d\d\d\d\d_)?\d\d\d\d\d\d.WAV$/` and have the correct WAV header comment.

### Example applications using this module ###
* [AudioMoth Configuration App](https://github.com/OpenAcousticDevices/AudioMoth-Configuration-App)

### License ###

Copyright 2017 [Open Acoustic Devices](http://www.openacousticdevices.info/).

[MIT license](http://www.openacousticdevices.info/license).
