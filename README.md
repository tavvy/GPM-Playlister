# GPM-Playlister
A command line Node.js tool that generates a Google Play Music playlist from a BBC Playlister url (http://www.bbc.co.uk/music/playlister)

### Dependencies
- [Node.js](https://nodejs.org)
- A Google Play Music account with these [permissions](https://github.com/jamon/playmusic#authentication)

### Installation
Clone the repo and run `npm install`. Next run `npm install -g` to install GPM-Playlister  as a global package.

## Usage
### Login
First you must login to a valid Google Play Music account.

If you use two step authentication you must use a newly created [app password](https://security.google.com/settings/security/apppasswords). 

Alternatvely ensure the "Allow less secure apps" setting is "ON" [found here](https://myaccount.google.com/security#connectedapps).
```
gpm-playlister login <username> <password>
```
Run login again to either change or update the stored user account.

__What does this do?__
Due to no offcial GPM api we have to use an [unofficial one](https://github.com/jamon/playmusic#attribution). This will create a mock 'Android' device on your account, which you would be able to see [here](https://security.google.com/settings/security/activity). The mock android id as well as the login token is saved locally in: [config/user-data.json](config/user-data.json). The app __does not__ locally save your username and login.

### Create playlist
Once logged in you can run `gpm-playlister create [options] <bbc-playlister-url>` to generate a GPM playlist. Example:
```
gpm-playlister create http://www.bbc.co.uk/music/playlists/zzzzwj
```
## Options
### -g Guided playlist creation
This will ask for the users help to match songs from results if no exact matches are found.
```
gpm-playlister create -g http://www.bbc.co.uk/music/playlists/zzzzwj
```
### -s Preset station
The app can also generate playlists from the preset stations available in the [config/stations.js](config/stations.js). The following would generate a playlist from the [BBC Radio 1 playlist](http://www.bbc.co.uk/radio1/playlist).
```
gpm-playlister create -s 1
```
## Todo
- push playlists to GPM - currently the app only outputs an array of store ids

## Attribution
- https://github.com/jamon/playmusic - Google Play Music client for Node

## License
GPM-Playlister is licensed under the [MIT](LICENSE.md) license.
Copyright © 2016, Adam Tavener
