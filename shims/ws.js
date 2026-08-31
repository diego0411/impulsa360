class UnsupportedWebSocket {
  constructor() {
    throw new Error('Node ws is not available in this React Native bundle.');
  }
}

module.exports = UnsupportedWebSocket;
module.exports.default = UnsupportedWebSocket;
