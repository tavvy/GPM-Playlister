
'use strict';

/**
 * FUZZY REGEX PHRASES
 * Array of regexp to search and transformations to perform on successful find
 */
module.exports = [
	{
		regexp: /\(RADIO EDIT\) | \(RADIO EDIT\)|\(RADIO EDIT\)/ig, // (radio edit) with space before or after
		transform: function(title, regexp) {
			return remove(title, regexp);
		}
	},
	{
		regexp: /\&/ig, // & ampersands
		transform: function(title, regexp) {
			return replace(title, regexp, 'AND');
		}
	},
	{
		regexp: /FEAT\.|FEATURING/ig, // feat. or feat or featuring
		transform: function(title, regexp) {
			return replace(title, regexp, 'FEAT');
		}
	},
	{
		regexp: /\(|\)/ig, // parenthesis
		transform: function(title, regexp) {
			return remove(title, regexp);
		}
	},
	{
		regexp: /\'|\’/ig, // odd apostrophes
		transform: function(title, regexp) {
			return replace(title, regexp, '\'');
		}
	},
	{
		regexp: /\?/ig, // ? question marks
		transform: function(title, regexp) {
			return remove(title, regexp);
		}
	}
];
/**
 * REPLACE
 * will replace matching regexp in title with given string
 * @param {String} title - the title
 * @param {Regexp} regexp - regexp to replace
 * @param {String} string - string to replace with
 * @returns {String} - the new title
 */
function replace(title, regexp, string) {
	return title.replace(regexp, string);
}
/**
 * REMOVE
 * will remove matching regexp in title
 * @param {String} title - the title
 * @param {Regexp} regexp - regexp to remove
 * @returns {String} - the new title
 */
function remove(title, regexp) {
	return title.replace(regexp, '');
}
