# AudioMoth-Utils #
A Node.js library for performing various tasks involving AudioMoth and files created by the AudioMoth. The module is hosted on npm under the name 'audiomoth-utils'.

### Usage ###

The module should be imported as normal:

```javascript
var audiomothUtils = require('audiomoth-utils');
```

#### Expanding, Splitting, Downsampling and Syncing ####

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

---
Downsample an AudioMoth WAV file to a lower sample rate:

```javascript
audiomothUtils.downsample(inputPath, outputPath, prefix, requestedSampleRate, (progress) => {
    console.log(progress + '% completed');
}));
```

To be identified as an AudioMoth WAV file, a recording must fit the regex `/^(\d\d\d\d\d\d\d\d_)?\d\d\d\d\d\d.WAV$/` and have the correct WAV header comment.

---
Synchronise an AudioMoth WAV file recorded using the AudioMoth-GPS-Sync firmware:

```javascript
audiomothUtils.sync(inputPath, outputPath, prefix, resampleRate, autoResolve, (progress) => {
    console.log(progress + '% completed');
}));
```

To be identified as an AudioMoth WAV file, a recording must fit the regex `/^(\d\d\d\d\d\d\d\d_)?\d\d\d\d\d\d.WAV$/` and have the correct WAV header comment. The function will check for, and load, the associated CSV file generated by the AudioMoth-GPS-Sync firmware.

#### Summarising AudioMoth Files ####

To summarise a folder of AudioMoth files first clear any previous summary:

```javascript
audiomothUtils.summariser.initialise();
```

Then provide the path to the parent folder and each individual file:

```javascript
audiomothUtils.summariser.summarise(folderPath, filePath,, (progress) => {
    console.log(progress + '% completed');
}));
```

Finally, write the summary CSV file to a destination:

```javascript
audiomothUtils.summariser.finalise(outputPath);
```

### Example applications using this module ###
* [AudioMoth Configuration App](https://github.com/OpenAcousticDevices/AudioMoth-Configuration-App)

### License ###

Copyright 2017 [Open Acoustic Devices](http://www.openacousticdevices.info/).

[MIT license](http://www.openacousticdevices.info/license).
