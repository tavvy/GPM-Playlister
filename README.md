# GPM-Playlister
A command line Node.js tool that generates a [Google Play Music](https://play.google.com/music) playlist from a [BBC Playlister](http://www.bbc.co.uk/music/playlists) url.
```
gpm-playlister generate http://www.bbc.co.uk/playlist/zzzzwj
gpm-playlister generate -s radioscotland
```

![example generate command output](https://cloud.githubusercontent.com/assets/660635/12484040/2be929f6-c050-11e5-892a-253e996b5869.png)

## Table of contents
- [Requirements](#requirements)
- [Installation](#installation)
- [Usage](#usage)
 - [Login](#login)
 - [Generate](#generate)
 - [Options](#options)
- [Example output](#example-output)
- [Attribution](#attribution)
- [License](#license)

## Requirements
- [Node.js](https://nodejs.org) 0.12+
- A Google Play Music account with these [permissions](https://github.com/jamon/playmusic#authentication)

## Installation
```
npm install -g gpm-playlister
```
**Permissions:** *GPM-Playlister* needs to be able to write to the file system ([login](#login)). Using `sudo` to install and when running the `login` command would resolve any permission errors. However it would be better to [fix your npm permissions](https://docs.npmjs.com/getting-started/fixing-npm-permissions).

## Usage
```
gpm-playlister --help

  Usage: gpm-playlister command [options] <argument...>

  Commands:
    generate [options] <url|station_name>  Generate a playlist
    login <google_username> <password>     login to google music

  Command help:
    gpm-playlister login -h
    gpm-playlister generate -h
```

## Login
First you must authorise *GPM-Playlister* to access your Google Play Music account.
```
gpm-playlister login --help

  Usage: login <google_username> <password>

  Example:
    gpm-playlister login example@gmail.com password123
```
Run `login` again to either change or update the account *GPM-Playlister* is authorised against.

- **Google account using two step authentication:**
you must use a newly created [app password](https://security.google.com/settings/security/apppasswords), in place of your usual account password.
  - *Use the 'Select App' dropdown to pick 'Other (Custom Name)', I would suggest using 'GPM-Playlister' as the name. This will generate a password for use with this tool*.

- **Regular Google accounts:**
Ensure the "Allow less secure apps" setting is "ON" [found here](https://myaccount.google.com/security#connectedapps).

---

__What does this do?__
Due to no official GPM API we have to use an [unofficial one](https://github.com/jamon/playmusic#attribution). This will create a mock 'Android' device on your account, which you would be able to see [here](https://security.google.com/settings/security/activity). The mock android id and token is saved locally in: `config/auth-token.json`. *GPM-Playlister* will masquerade as this authorised device. The app __does not__ locally save your username and password.

---

## Generate
*Requires authorisation. See: [Login](#login)*
```
gpm-playlister generate --help

  Usage: generate [options] (<url> | <station_name>)

  Options:
    -s, --station  Station mode: Required when using station name instead of url
    -g, --guided   Guided mode: ask for help when finding matching search results
    -r, --replace  Replace mode: Replace existing GPM playlist

  Examples:
    gpm-playlister generate -s radio1
    gpm-playlister generate -s -r -g radio1
    gpm-playlister generate http://www.bbc.co.uk/playlist/zzzzwj
    gpm-playlister generate -r -g http://www.bbc.co.uk/playlist/zzzzwj
```
Generate will create/replace a playlist in your Google Play Music library containing:
- A name and description pulled from the BBC Playlister source, as well as a link to the source.
- A track list populated with matching songs where a match can be found on GPM.
 - Fuzzy matching will be used to help resolve common differences in titles, such as the use of a `(Radio Edit)` classification, or using  `feat.` as apposed to `featuring`.
 - Track ordering will be maintained from the source.

### Sources
- Browse BBC Playlists here: [http://www.bbc.co.uk/music/playlists](http://www.bbc.co.uk/music/playlists)
- See supported BBC stations here: [config/stations.json](config/stations.json)

## Options

### -g --guided Guided mode
This will ask for user help to match songs from results if no exact matches are found.
```
gpm-playlister generate -g http://www.bbc.co.uk/music/playlists/zzzzwj
```
![example guided mode](https://cloud.githubusercontent.com/assets/660635/12455089/2a873cce-bf92-11e5-8291-d56a352ba5a6.jpg)

### -s --station Station mode
*GPM-Playlister* can also generate playlists from the preset stations available in the [config/stations.json](config/stations.json). These are BBC radio playlists that are updated weekly. The following would generate a playlist from the [BBC Radio 1 playlist](http://www.bbc.co.uk/radio1/playlist).
```
gpm-playlister generate -s radio1
```

### -r --replace Replace mode
Will replace an existing GPM playlist if one is found with the same name. If there isn't a match, a new playlist will be generated.
```
gpm-playlister generate -r http://www.bbc.co.uk/music/playlists/zzzzwj
gpm-playlister generate -r -s radio1
```
This is useful in several use cases:
- Maintaining an up-to-date playlist from the weekly updates to the BBC Radio track listings.
- Maintaing a publicly shared GPM playlist url, such that the playlist can be updated.
- If you have the GPM Playlist downloaded, then changes to a playlist will be automatically downloaded to the GPM app.
- Replacing the playlist with one with better matches i.e using guided mode

### Multiple options
Short flags may be passed as a single arg, for example `-srg` is equivalent to `-s -r -g`.
```
gpm-playlister generate -srg radio1
```

## Example output
Station: [BBC Radio 6 Playlist source](http://www.bbc.co.uk/6music/playlist) -> [Shared GPM Playlist Output](https://play.google.com/music/playlist/AMaBXykB4DvY268UVOTI770jkvZbPwa2OWMmlUA1hQsN4BWX_dVrHVsuk7XD6lZz4Ml3q8sswF2_SKUL5lNvR7W94aqTr11quw==)

BBC Playlist: [David Bowie: A Life In Music source](http://www.bbc.co.uk/music/playlists/zzzzwj) -> [Shared GPM Playlist Output](https://play.google.com/music/playlist/AMaBXynlrdYtuBGhe-iGWG-i36WmKLHCRmobwntRm7-ToJAmhcBxPaRTu1RQh7DiI_1mrFoeXs4PPvqdhkQnzeMBOEqss4k-9g==)

*Note: These playlists are generated by myself and shared publicly. They may not always be up-to-date.*

## Attribution
- https://github.com/jamon/playmusic - Google Play Music client for Node

## To Do
- Test tool from countries other than UK (BBC Playlister may be region locked)
- Write tests
- Improve fuzzy matching
- Allow fuzzy matching of artists (Maximo Park -> Max**ï**mo Park)
- Logout functionality
- Custom auth-token.json location, so that it may persist with updates to the tool
- Store final report as log file

## License
GPM-Playlister is licensed under the [MIT](LICENSE.md) license.
Copyright © 2016, Adam Tavener
