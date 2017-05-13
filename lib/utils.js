
'use strict';

const fuzzify = require('./fuzzy-regex');
const jsonfile = require('jsonfile');

/**
 * Promisify jsonFile.readFile method
 */
const readJson = (path) => new Promise((resolve, reject) => {
	return jsonfile.readFile(path, (err, data) => err ? reject(err) : resolve(data));
});
/**
 * Check URL is valid Playlister source
 * @param {String} - url - the url to check
 * @return {Boolean} - if url is a valid bbc playlister url
 */
const isPlaylisterUrl = (url) => url && url.search(/bbc\.co\.uk/ig) !== -1;
/**
 * Filter and then store tracklist entries with a GPM-Store-ID
 * @param {Array} tl (trackList) - an array of objects containing tracks title, artist and optional GPM-Store-ID
 * @returns {Array} storeIdList - an array of GPM-Store-IDS
 */
const mapStoreIds = (tl) => tl.filter(t => t.gpmStoreId).map(t => t.gpmStoreId);
/**
 * Validate and check GPM playlist matches given name
 * @param {Object} pl (playlist) - contains GPM playlist data
 * @param {String} n (name) - playlist name to find
 * @returns {Boolean} - if playlist is a match
 */
const isPlaylistNameMatch = (pl, n) => pl.deleted === false && pl.name === n && pl.type === 'USER_GENERATED';
/**
 * Find a fuzzy title match on the result from query
 * @param {Object} r (result) - GPM search result
 * @param {Object} q (query) - contains the title and artist of the track to find
 * @return {Boolean} - if title is a fuzzy match
 */
const isFuzzyMatch = (r, q) => fuzzify(r.track.title) === fuzzify(q.title);
/**
 * Validate the auth-token file and its contents
 * @param {Data} - authFileData - the contents of config/auth-token.json
 * @callback {err, Object} - authFileData - the verified androidId and masterToken
 */
const isValidAuth = (authFileData) => new Promise((resolve, reject) => {
	// issue with contents of file
	if (authFileData.constructor !== Object) {
		return reject(new Error('The contents of auth-token file are corrupt'));
	}
	// check if valid
	if (authFileData && authFileData.androidId && authFileData.masterToken) {
		return resolve(authFileData);
	}
	// invalid credentials
	return reject(new Error('Invalid auth-token'));
});
/**
 * Validate song result. If query is passed, will also validate that the artist match
 * @param {Object} r (result) - GPM search result
 * @param {Object} [optional] q (query) - contains the title and artist of the track to find
 * @return {Boolean} - isValid - if result is a valid song result (optional: and has a matching artist)
 */
const isValidResult = (r, q) => {
	let isValid = r.type === 1 || '1' && r.track && r.track.artist && r.track.title && r.track.storeId;
	if (isValid && q && r.track.artist.toUpperCase() !== q.artist.toUpperCase()) {
		// invalid artist match
		isValid = false;
	}
	return isValid;
}

module.exports = {readJson, isPlaylisterUrl, mapStoreIds, isPlaylistNameMatch, isFuzzyMatch, isValidAuth, isValidResult};
