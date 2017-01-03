
'use strict';

/**
 * CHECK URL IS VALID
 * @param {String} - url - the url to check
 * @return {Boolean} - isValid - if url is a valid bbc playlister url
 */
const isPlaylisterUrl = (url) => url && url.search(/bbc\.co\.uk/ig) !== -1;

module.exports = {isPlaylisterUrl};
