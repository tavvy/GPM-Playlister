
const path = require('path');

const schema = require('./schema');
const presetStations = require('./stations');
const authPath = path.join(__dirname, './auth-token.json');

module.exports = {schema, presetStations, authPath};
