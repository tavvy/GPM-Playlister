
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
var reporter = require('./reporter');

var schema = JSON.parse(JSON.stringify(require(path.join(__dirname, '..', 'config/schema'))));
var presetStations = JSON.parse(JSON.stringify(require(path.join(__dirname, '..', 'config/stations'))));
var userConfig = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'config/user-data.json')));
var fuzzyRegex = require(path.join(__dirname, '..', 'config/fuzzy-regex.js'));

var pm = new PlayMusic();

module.exports = app;

function app(options) {

	// set up options
	options.schema = options.station ? schema.bbc_station : schema.bbc_playlister;
	options.url = options.station ? presetStations[options.station] : options.url;

	// check logged in
	if (!checkLogin()) {
		reporter.err('need to set up login first');
		throw new Error('invalid login details');
	}
	// check url
	if (!checkUrl(options.url)) {
		reporter.err('not a valid bbc playlister url');
		throw new Error('invalid url');
	}

	reporter.info('Building a playlist from: ' + options.url);

	async.waterfall([
		function(cbAsync) {
			fetchPlrTracklist(options, function(err, trackList) {
				if (!err) {
					reporter.info('Playlist at ' + options.url + ' is ' + trackList.length + ' tracks long');
				}
				cbAsync(err, trackList);
			});
		},
		function(trackList, cbAsync) {
			createGPMStoreIdList(trackList, options, function(err, storeIdlist) {
				if (!err) {
					reporter.info('Finished search we have ' + storeIdlist.length + ' of ' + trackList.length + ' matches');
				}
				cbAsync(err, storeIdlist);
			});
		}
	], function(err, result) {
		if (err) {
			reporter.err(err.reporterMsg || 'there was an error');
			throw new Error(err.reporterMsg || 'there was an error');
		}
		console.log(result);
	});


}

function checkLogin() {
	let isValid = false;
	if (userConfig.androidId && userConfig.masterToken) {
		isValid = true;
	}
	return isValid;
}

function checkUrl(url) {
	let isValid = false;
	if (url && url.search(/bbc\.co\.uk/ig) !== -1) {
		isValid = true;
	}
	return isValid;
}

function fetchPlrTracklist(options, callback) {
	let opts = {
		uri: options.url,
		transform: function(htmlString) {
			return parsePlrTracklist(htmlString, options.schema);
		}
	};

	rp(opts)
	.then(function(autoParsedBody) {
		callback(null, autoParsedBody);
	})
	.catch(function(err) {
		err.reporterMsg = 'there was an error with the content of: ' + options.uri;
		callback(err);
	});
}

function parsePlrTracklist(htmlString, schema) {
	let $ = cheerio.load(htmlString);
	let trackList = [];
	let selector = schema;

	$(selector.track_selector, selector.tracklist_selector).each(function(i, el) {
		let track_artist = $(selector.artist_selector, el).text().trim() || $(selector.alt_artist_selector, el).text().trim() || null;
		let track_title = $(selector.title_selector, el).text().trim() || null;
		trackList.push({
			title: track_title,
			artist: track_artist
		});
	});

	return trackList;
}

function createGPMStoreIdList(trackList, options, callback) {
	let storeIds = [];

	pm.init(userConfig, function(err) {
		if (err) {
			return reporter.err(err);
		}

		// for each song in the trackList
		async.forEachOf(trackList, function(track, i, cbAsync) {

			// search Google Music for <artist> <title>, max 5 results
			pm.search(track.artist + ' ' + track.title, 5, function(err, data) {
				if (!err && data.entries) {
					matchResult(data.entries, track, options, function(matchStoreId) {
						if (matchStoreId) {
							storeIds.push(matchStoreId);
						}
					});
				} else {
					reporter.match(null, track);
				}
				cbAsync(err);
			});

		}, function(err) {
			if (err) {
				err.reporterMsg = 'Error during Google Music search';
			}
			callback(err, storeIds);
		});


	});

}

function matchResult(results, query, options, callback) {
	let match = {
		data: null,
		matchType: 0,
		storeId: null
	};

	// try and find a matching result
	results.forEach(item => {
		// if its a valid song and we havnt found a match yet
		if (!match.data && validateGPMSongResult(item, query)) {

			if (item.track.title.toUpperCase() === query.title.toUpperCase()) { // exact match title
				match.data = item;
				match.matchType = 1;
				match.storeId = item.track.storeId;
			} else if (fuzzyMatchTitle(item, query)) {
				match.data = item;
				match.matchType = 2;
				match.storeId = item.track.storeId;
			}

		}
	});

	// ask user for help
	if (!match.data && options.guided) {
		userMatch(results, query, function(item) {
			if (item) {
				match.data = item;
				match.matchType = 3;
				match.storeId = item.track.storeId;
			}
		});
	}

	reporter.match(match.matchType, query, match.data);

	return callback(match.storeId);
}

/*
 * VALIDATE GPM SONG
 * check that the result is a valid song, query optional
 * if query is passed, will also validate that the artists match
 */
function validateGPMSongResult(result, query) {
	let isValid = false;
	if (result.type === 1 || '1' && result.track && result.track.artist && result.track.title && result.track.storeId) {
		isValid = true;
	}
	if (isValid && query && result.track.artist.toUpperCase() !== query.artist.toUpperCase()) {
		isValid = false;
	}
	return isValid;
}

/*
 * FUZZY MATCH TITLE
 * will attempt to find a fuzzy match on the result and query
 */
function fuzzyMatchTitle(result, query) {
	let queryTitle = query.title.toUpperCase();
	let targetTitle = result.track.title.toUpperCase();
	let isMatch = false;

	if (fuzzTitle(targetTitle) === fuzzTitle(queryTitle)) {
		isMatch = true;
	}
	return isMatch;
}

/*
 * FUZZ-IFY A TITLE
 * will perfom some basic transformations on a string to help fuzzy match
 */
function fuzzTitle(title) {
	let fuzzyTitle = title;
	let phrases = fuzzyRegex;

	phrases.forEach(phrase => {
		if (fuzzyTitle.search(phrase.regexp) !== -1) {
			if (phrase.replace) {
				fuzzyTitle = fuzzyTitle.replace(phrase.regexp, phrase.replace);
			}
			if (phrase.delete) {
				fuzzyTitle = fuzzyTitle.replace(phrase.regexp, '');
			}
		}
	});

	return fuzzyTitle;
}

/*
 * USER MATCH
 * will ask the user to pick an item from results that best matches the query
 * returns answer, can be null
 */
function userMatch(results, query, callback) {
	let mappedResults = {};
	let match = null;

	results.forEach(item => {
		if (validateGPMSongResult(item)) {
			let key = item.track.artist + ' - ' + item.track.title;
			mappedResults[key] = item;
		}
	});

	// if we have a results list
	if (Object.keys(mappedResults).length > 0) {

		// use readlineSync to get a user match
		let userAnswerIndex = readlineSync.keyInSelect(Object.keys(mappedResults),
			chalk.green(
				'Possible match. Which of the above is match for: ' +
				chalk.blue(query.artist + ' - ' + query.title)
			)
		);

		let answerKey = Object.keys(mappedResults)[userAnswerIndex];
		match = mappedResults[answerKey];

	}

	callback(match);
}
