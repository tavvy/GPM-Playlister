
'use strict';

require('babel-register');

var fs = require('fs');
var path = require('path');
var chalk = require('chalk');
var rp = require('request-promise');
var cheerio = require('cheerio');
var PlayMusic = require('playmusic');
var async = require('async');
var readlineSync = require('readline-sync');

var schema = require(path.join(__dirname, '..', 'config/schema'));
var presetStations = require(path.join(__dirname, '..', 'config/stations'));
var userConfig = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'config/user-data.json')));

module.exports = app;

var pm = new PlayMusic();

function app(options) {

	// set up options
	options.schema = options.station ? schema.bbc_station : schema.bbc_playlister;
	options.url = options.station ? presetStations[options.station] : options.url;

	// check logged in
	checkLogin(function(err) {
		if (err) {
			console.log(chalk.red(err.message));
			throw new Error('invalid login details');
		}
	});

	console.log(chalk.blue('Building a playlist from: ' + options.url));

	if (options.url) {
		fetchPlrPlaylist(options, function(err, response) {
			if (err) {
				return console.log(chalk.red('there was an error with the content of: ' + options.url));
			}
			console.log(chalk.yellow('Playlist at ' + options.url + ' is ' + response.length + ' tracks long'));
			createStoreIdList(response, options, function(storeIdlist) {
				console.log(storeIdlist);
			});
		});
	}
}

function checkLogin(callback) {
	if (!userConfig.androidId && !userConfig.masterToken) {
		return callback({message: 'need to set up login first'});
	}
	callback(null);
}

function fetchPlrPlaylist(opts, callback) {
	var options = {
		uri: opts.url,
		transform: function(htmlString) {
			return parsePlrPlaylist(htmlString, opts.schema);
		}
	};

	rp(options)
	.then(function(autoParsedBody) {
		callback(null, autoParsedBody);
	})
	.catch(function(err) {
		callback(err);
	});
}

function parsePlrPlaylist(htmlString, schema) {
	var $ = cheerio.load(htmlString);
	var trackList = [];
	var selector = schema;

	$(selector.track_selector, selector.tracklist_selector).each(function(i, el) {
		var artist = $(selector.artist_selector, el).text().trim() || $(selector.alt_artist_selector, el).text().trim() || null;
		var track_title = $(selector.title_selector, el).text().trim() || null;
		trackList.push({
			title: track_title,
			artist: artist
		});
	});

	return trackList;
}

function createStoreIdList(playlist, options, callback) {
	var gpmStoreIds = [];

	pm.init(userConfig, function(err) {
		if (err) {
			return console.log(err);
		}

		// for each song in the playlist
		async.forEachOf(playlist, function(track, i, callback) {
			// search gm for it
			pm.search(track.artist + ' ' + track.title, 5, function(err, data) { // max 5 results
				if (!err && data.entries) {
					matchResult(data.entries, track, options, function(match) {
						if (match) {
							gpmStoreIds.push(match);
						}
					});
				} else {
					console.log(
						chalk.red('No results for ') +
						chalk.blue(track.artist + ' - ' + track.title)
					);
				}
				callback();
			});

		}, function(err) {
			if (err) {
				console.error(err.message);
				throw new Error('Error during gm search' + err.message);
			}
			console.log(chalk.green('Finished search we have ' + gpmStoreIds.length + ' of ' + playlist.length + ' matches'));
			// now push the gpmStoreIds to a gm playlist
			callback(gpmStoreIds);
		});


	});

}

function matchResult(results, target, options, callback) {
	var song = null;
	var matchType = null;

	// try and find a result
	results.forEach(function(item) {
		// if its a valid song and we havnt found a match yet
		if (validateGPMSongResult(item) && !song) {
			// if the artists match
			if (item.track.artist.toUpperCase() === target.artist.toUpperCase()) {

				if (item.track.title.toUpperCase() === target.title.toUpperCase()) {
					song = item;
					matchType = 1;
					return;
				} else if (stripTitle(item.track.title.toUpperCase()) === target.title.toUpperCase() || stripTitle(item.track.title.toUpperCase()) === stripTitle(target.title.toUpperCase())) {
					song = item;
					matchType = 2;
					return;
				}

			}
		}
	});

	// ask user for help
	if (!song && options.guided) {
		userMatch(results, target, function(match) {
			if (match) {
				song = match;
				matchType = 3;
			}
		});
	}

	// print out message
	if (song && matchType === 1) {
		console.log(
			chalk.green('Found match ') +
			chalk.blue(target.artist + ' - ' + target.title) +
			chalk.gray(' -> ') +
			chalk.yellow(song.track.artist + ' - ' + song.track.title)
		);
	} else if (song && matchType === 2) {
		console.log(
			chalk.yellow('Found match ') +
			chalk.blue(target.artist + ' - ' + target.title) +
			chalk.gray(' -> ') +
			chalk.yellow(song.track.artist + ' - ' + song.track.title)
		);
	} else if (song && matchType === 3) {
		console.log(
			chalk.yellow('User match ') +
			chalk.blue(target.artist + ' - ' + target.title) +
			chalk.gray(' -> ') +
			chalk.yellow(song.track.artist + ' - ' + song.track.title)
		);
	} else if (!song) {
		console.log(
			chalk.red('No match ') +
			chalk.blue(target.artist + ' - ' + target.title)
		);
	}

	var storeId = song && song.track && song.track.storeId ? song.track.storeId : null;
	return callback(storeId);
}

function validateGPMSongResult(result) {
	if (result.type === 1 || '1' && result.track && !result.navigational_result && result.track.artist && result.track.title) {
		return true;
	}
	return false;
}

function userMatch(results, target, callback) {

	var songs = [];
	var songsData = [];
	var result = null;

	results.forEach(function(item) {
		if (item.type === 1 || '1' && item.track && !item.navigational_result) {
			songs.push(item.track.artist + ' - ' + item.track.title);
			songsData.push(item);
		}
	});

	var index = readlineSync.keyInSelect(songs,
		chalk.green(
			'Possible match. Which of the above is match for: ' +
			chalk.blue(target.artist + ' - ' + target.title)
		)
	);

	result = songsData[index] || null;
	callback(result);
}

function stripTitle(title) {
	var toRemove = [
		{
			term: '(RADIO EDIT) ',
			replace: ''
		},
		{
			term: ' (RADIO EDIT)',
			replace: ''
		},
		{
			term: '(RADIO EDIT)',
			replace: ''
		},
		{
			term: '&',
			replace: 'AND'
		}
	];
	var stripTitle = title;

	toRemove.forEach(function(item) {
		if (title.indexOf(item.term) !== 1) {
			stripTitle = stripTitle.replace(item.term, item.replace);
		}
	});

	return stripTitle;
}
