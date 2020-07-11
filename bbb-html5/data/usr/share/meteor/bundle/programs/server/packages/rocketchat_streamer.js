(function () {

/* Imports */
var Meteor = Package.meteor.Meteor;
var global = Package.meteor.global;
var meteorEnv = Package.meteor.meteorEnv;
var DDPCommon = Package['ddp-common'].DDPCommon;
var ECMAScript = Package.ecmascript.ECMAScript;
var check = Package.check.check;
var Match = Package.check.Match;
var Tracker = Package.tracker.Tracker;
var Deps = Package.tracker.Deps;
var meteorInstall = Package.modules.meteorInstall;
var Promise = Package.promise.Promise;

/* Package-scope variables */
var EV, fn, eventName, Streamer;

var require = meteorInstall({"node_modules":{"meteor":{"rocketchat:streamer":{"lib":{"ev.js":function module(){

////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
//                                                                                                                //
// packages/rocketchat_streamer/lib/ev.js                                                                         //
//                                                                                                                //
////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
                                                                                                                  //
/* globals EV:true */

/* exported EV */
EV = class EV {
  constructor() {
    this.handlers = {};
  }

  emit(event) {
    for (var _len = arguments.length, args = new Array(_len > 1 ? _len - 1 : 0), _key = 1; _key < _len; _key++) {
      args[_key - 1] = arguments[_key];
    }

    return this.handlers[event] && this.handlers[event].forEach(handler => handler.apply(this, args));
  }

  emitWithScope(event, scope) {
    for (var _len2 = arguments.length, args = new Array(_len2 > 2 ? _len2 - 2 : 0), _key2 = 2; _key2 < _len2; _key2++) {
      args[_key2 - 2] = arguments[_key2];
    }

    return this.handlers[event] && this.handlers[event].forEach(handler => handler.apply(scope, args));
  }

  listenerCount(event) {
    return this.handlers[event] && this.handlers[event].length || 0;
  }

  on(event, callback) {
    if (!this.handlers[event]) {
      this.handlers[event] = [];
    }

    this.handlers[event].push(callback);
  }

  once(event, callback) {
    const self = this;
    this.on(event, function onetimeCallback() {
      self.removeListener(event, onetimeCallback);
      callback.apply(this, arguments);
    });
  }

  removeListener(event, callback) {
    if (!this.handlers[event]) {
      return;
    }

    const index = this.handlers[event].indexOf(callback);

    if (index > -1) {
      this.handlers[event].splice(index, 1);
    }
  }

  removeAllListeners(event) {
    this.handlers[event] = undefined;
  }

};
////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

}},"server":{"server.js":function module(require,exports,module){

////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
//                                                                                                                //
// packages/rocketchat_streamer/server/server.js                                                                  //
//                                                                                                                //
////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
                                                                                                                  //
let DDPCommon;
module.link("meteor/ddp-common", {
  DDPCommon(v) {
    DDPCommon = v;
  }

}, 0);

class StreamerCentral extends EV {
  constructor() {
    super();
    this.instances = {};
  }

}

Meteor.StreamerCentral = new StreamerCentral();

const changedPayload = function (collection, id, fields) {
  if (_.isEmpty(fields)) {
    return;
  }

  return DDPCommon.stringifyDDP({
    msg: 'changed',
    collection,
    id,
    fields
  });
};

const send = function (self, msg) {
  if (!self.socket) {
    return;
  }

  self.socket.send(msg);
};

Meteor.Streamer = class Streamer extends EV {
  constructor(name) {
    let {
      retransmit = true,
      retransmitToSelf = false
    } = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : {};

    if (Meteor.StreamerCentral.instances[name]) {
      console.warn('Streamer instance already exists:', name);
      return Meteor.StreamerCentral.instances[name];
    }

    super();
    Meteor.StreamerCentral.instances[name] = this;
    this.name = name;
    this.retransmit = retransmit;
    this.retransmitToSelf = retransmitToSelf;
    this.subscriptions = [];
    this.subscriptionsByEventName = {};
    this.transformers = {};
    this.iniPublication();
    this.initMethod();
    this._allowRead = {};
    this._allowEmit = {};
    this._allowWrite = {};
    this.allowRead('none');
    this.allowEmit('all');
    this.allowWrite('none');
  }

  get name() {
    return this._name;
  }

  set name(name) {
    check(name, String);
    this._name = name;
  }

  get subscriptionName() {
    return "stream-".concat(this.name);
  }

  get retransmit() {
    return this._retransmit;
  }

  set retransmit(retransmit) {
    check(retransmit, Boolean);
    this._retransmit = retransmit;
  }

  get retransmitToSelf() {
    return this._retransmitToSelf;
  }

  set retransmitToSelf(retransmitToSelf) {
    check(retransmitToSelf, Boolean);
    this._retransmitToSelf = retransmitToSelf;
  }

  allowRead(eventName, fn) {
    if (fn === undefined) {
      fn = eventName;
      eventName = '__all__';
    }

    if (typeof fn === 'function') {
      return this._allowRead[eventName] = fn;
    }

    if (typeof fn === 'string' && ['all', 'none', 'logged'].indexOf(fn) === -1) {
      console.error("allowRead shortcut '".concat(fn, "' is invalid"));
    }

    if (fn === 'all' || fn === true) {
      return this._allowRead[eventName] = function () {
        return true;
      };
    }

    if (fn === 'none' || fn === false) {
      return this._allowRead[eventName] = function () {
        return false;
      };
    }

    if (fn === 'logged') {
      return this._allowRead[eventName] = function () {
        return Boolean(this.userId);
      };
    }
  }

  allowEmit(eventName, fn) {
    if (fn === undefined) {
      fn = eventName;
      eventName = '__all__';
    }

    if (typeof fn === 'function') {
      return this._allowEmit[eventName] = fn;
    }

    if (typeof fn === 'string' && ['all', 'none', 'logged'].indexOf(fn) === -1) {
      console.error("allowRead shortcut '".concat(fn, "' is invalid"));
    }

    if (fn === 'all' || fn === true) {
      return this._allowEmit[eventName] = function () {
        return true;
      };
    }

    if (fn === 'none' || fn === false) {
      return this._allowEmit[eventName] = function () {
        return false;
      };
    }

    if (fn === 'logged') {
      return this._allowEmit[eventName] = function () {
        return Boolean(this.userId);
      };
    }
  }

  allowWrite(eventName, fn) {
    if (fn === undefined) {
      fn = eventName;
      eventName = '__all__';
    }

    if (typeof fn === 'function') {
      return this._allowWrite[eventName] = fn;
    }

    if (typeof fn === 'string' && ['all', 'none', 'logged'].indexOf(fn) === -1) {
      console.error("allowWrite shortcut '".concat(fn, "' is invalid"));
    }

    if (fn === 'all' || fn === true) {
      return this._allowWrite[eventName] = function () {
        return true;
      };
    }

    if (fn === 'none' || fn === false) {
      return this._allowWrite[eventName] = function () {
        return false;
      };
    }

    if (fn === 'logged') {
      return this._allowWrite[eventName] = function () {
        return Boolean(this.userId);
      };
    }
  }

  isReadAllowed(scope, eventName, args) {
    if (this._allowRead[eventName]) {
      return this._allowRead[eventName].call(scope, eventName, ...args);
    }

    return this._allowRead['__all__'].call(scope, eventName, ...args);
  }

  isEmitAllowed(scope, eventName) {
    for (var _len = arguments.length, args = new Array(_len > 2 ? _len - 2 : 0), _key = 2; _key < _len; _key++) {
      args[_key - 2] = arguments[_key];
    }

    if (this._allowEmit[eventName]) {
      return this._allowEmit[eventName].call(scope, eventName, ...args);
    }

    return this._allowEmit['__all__'].call(scope, eventName, ...args);
  }

  isWriteAllowed(scope, eventName, args) {
    if (this._allowWrite[eventName]) {
      return this._allowWrite[eventName].call(scope, eventName, ...args);
    }

    return this._allowWrite['__all__'].call(scope, eventName, ...args);
  }

  addSubscription(subscription, eventName) {
    this.subscriptions.push(subscription);

    if (!this.subscriptionsByEventName[eventName]) {
      this.subscriptionsByEventName[eventName] = [];
    }

    this.subscriptionsByEventName[eventName].push(subscription);
  }

  removeSubscription(subscription, eventName) {
    const index = this.subscriptions.indexOf(subscription);

    if (index > -1) {
      this.subscriptions.splice(index, 1);
    }

    if (this.subscriptionsByEventName[eventName]) {
      const index = this.subscriptionsByEventName[eventName].indexOf(subscription);

      if (index > -1) {
        this.subscriptionsByEventName[eventName].splice(index, 1);
      }
    }
  }

  transform(eventName, fn) {
    if (typeof eventName === 'function') {
      fn = eventName;
      eventName = '__all__';
    }

    if (!this.transformers[eventName]) {
      this.transformers[eventName] = [];
    }

    this.transformers[eventName].push(fn);
  }

  applyTransformers(methodScope, eventName, args) {
    if (this.transformers['__all__']) {
      this.transformers['__all__'].forEach(transform => {
        args = transform.call(methodScope, eventName, args);
        methodScope.tranformed = true;

        if (!Array.isArray(args)) {
          args = [args];
        }
      });
    }

    if (this.transformers[eventName]) {
      this.transformers[eventName].forEach(transform => {
        args = transform.call(methodScope, ...args);
        methodScope.tranformed = true;

        if (!Array.isArray(args)) {
          args = [args];
        }
      });
    }

    return args;
  }

  _publish(publication, eventName, options) {
    check(eventName, String);
    check(options, Match.OneOf(Boolean, {
      useCollection: Boolean,
      args: Array
    }));
    let useCollection,
        args = [];

    if (typeof options === 'boolean') {
      useCollection = options;
    } else {
      if (options.useCollection) {
        useCollection = options.useCollection;
      }

      if (options.args) {
        args = options.args;
      }
    }

    if (eventName.length === 0) {
      publication.stop();
      throw new Meteor.Error('invalid-event-name');
    }

    if (this.isReadAllowed(publication, eventName, args) !== true) {
      publication.stop();
      throw new Meteor.Error('not-allowed');
    }

    const subscription = {
      subscription: publication,
      eventName: eventName
    };
    this.addSubscription(subscription, eventName);
    publication.onStop(() => {
      this.removeSubscription(subscription, eventName);
    });

    if (useCollection === true) {
      // Collection compatibility
      publication._session.sendAdded(this.subscriptionName, 'id', {
        eventName: eventName
      });
    }

    publication.ready();
  }

  iniPublication() {
    const stream = this;
    Meteor.publish(this.subscriptionName, function () {
      for (var _len2 = arguments.length, args = new Array(_len2), _key2 = 0; _key2 < _len2; _key2++) {
        args[_key2] = arguments[_key2];
      }

      return stream._publish.apply(stream, [this, ...args]);
    });
  }

  initMethod() {
    const stream = this;
    const method = {};

    method[this.subscriptionName] = function (eventName) {
      for (var _len3 = arguments.length, args = new Array(_len3 > 1 ? _len3 - 1 : 0), _key3 = 1; _key3 < _len3; _key3++) {
        args[_key3 - 1] = arguments[_key3];
      }

      check(eventName, String);
      check(args, Array);
      this.unblock();

      if (stream.isWriteAllowed(this, eventName, args) !== true) {
        return;
      }

      const methodScope = {
        userId: this.userId,
        connection: this.connection,
        originalParams: args,
        tranformed: false
      };
      args = stream.applyTransformers(methodScope, eventName, args);
      stream.emitWithScope(eventName, methodScope, ...args);

      if (stream.retransmit === true) {
        stream._emit(eventName, args, this.connection, true);
      }
    };

    try {
      Meteor.methods(method);
    } catch (e) {
      console.error(e);
    }
  }

  _emit(eventName, args, origin, broadcast) {
    if (broadcast === true) {
      Meteor.StreamerCentral.emit('broadcast', this.name, eventName, args);
    }

    const subscriptions = this.subscriptionsByEventName[eventName];

    if (!Array.isArray(subscriptions)) {
      return;
    }

    const msg = changedPayload(this.subscriptionName, 'id', {
      eventName,
      args
    });

    if (!msg) {
      return;
    }

    subscriptions.forEach(subscription => {
      if (this.retransmitToSelf === false && origin && origin === subscription.subscription.connection) {
        return;
      }

      if (this.isEmitAllowed(subscription.subscription, eventName, ...args)) {
        send(subscription.subscription._session, msg);
      }
    });
  }

  emit(eventName) {
    for (var _len4 = arguments.length, args = new Array(_len4 > 1 ? _len4 - 1 : 0), _key4 = 1; _key4 < _len4; _key4++) {
      args[_key4 - 1] = arguments[_key4];
    }

    this._emit(eventName, args, undefined, true);
  }

  __emit() {
    return super.emit(...arguments);
  }

  emitWithoutBroadcast(eventName) {
    for (var _len5 = arguments.length, args = new Array(_len5 > 1 ? _len5 - 1 : 0), _key5 = 1; _key5 < _len5; _key5++) {
      args[_key5 - 1] = arguments[_key5];
    }

    this._emit(eventName, args, undefined, false);
  }

};
////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

}}}}}},{
  "extensions": [
    ".js",
    ".json"
  ]
});

require("/node_modules/meteor/rocketchat:streamer/lib/ev.js");
require("/node_modules/meteor/rocketchat:streamer/server/server.js");

/* Exports */
Package._define("rocketchat:streamer", {
  Streamer: Streamer
});

})();

//# sourceURL=meteor://💻app/packages/rocketchat_streamer.js
//# sourceMappingURL=data:application/json;charset=utf8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIm1ldGVvcjovL/CfkrthcHAvcGFja2FnZXMvcm9ja2V0Y2hhdDpzdHJlYW1lci9saWIvZXYuanMiLCJtZXRlb3I6Ly/wn5K7YXBwL3BhY2thZ2VzL3JvY2tldGNoYXQ6c3RyZWFtZXIvc2VydmVyL3NlcnZlci5qcyJdLCJuYW1lcyI6WyJFViIsImNvbnN0cnVjdG9yIiwiaGFuZGxlcnMiLCJlbWl0IiwiZXZlbnQiLCJhcmdzIiwiZm9yRWFjaCIsImhhbmRsZXIiLCJhcHBseSIsImVtaXRXaXRoU2NvcGUiLCJzY29wZSIsImxpc3RlbmVyQ291bnQiLCJsZW5ndGgiLCJvbiIsImNhbGxiYWNrIiwicHVzaCIsIm9uY2UiLCJzZWxmIiwib25ldGltZUNhbGxiYWNrIiwicmVtb3ZlTGlzdGVuZXIiLCJhcmd1bWVudHMiLCJpbmRleCIsImluZGV4T2YiLCJzcGxpY2UiLCJyZW1vdmVBbGxMaXN0ZW5lcnMiLCJ1bmRlZmluZWQiLCJERFBDb21tb24iLCJtb2R1bGUiLCJsaW5rIiwidiIsIlN0cmVhbWVyQ2VudHJhbCIsImluc3RhbmNlcyIsIk1ldGVvciIsImNoYW5nZWRQYXlsb2FkIiwiY29sbGVjdGlvbiIsImlkIiwiZmllbGRzIiwiXyIsImlzRW1wdHkiLCJzdHJpbmdpZnlERFAiLCJtc2ciLCJzZW5kIiwic29ja2V0IiwiU3RyZWFtZXIiLCJuYW1lIiwicmV0cmFuc21pdCIsInJldHJhbnNtaXRUb1NlbGYiLCJjb25zb2xlIiwid2FybiIsInN1YnNjcmlwdGlvbnMiLCJzdWJzY3JpcHRpb25zQnlFdmVudE5hbWUiLCJ0cmFuc2Zvcm1lcnMiLCJpbmlQdWJsaWNhdGlvbiIsImluaXRNZXRob2QiLCJfYWxsb3dSZWFkIiwiX2FsbG93RW1pdCIsIl9hbGxvd1dyaXRlIiwiYWxsb3dSZWFkIiwiYWxsb3dFbWl0IiwiYWxsb3dXcml0ZSIsIl9uYW1lIiwiY2hlY2siLCJTdHJpbmciLCJzdWJzY3JpcHRpb25OYW1lIiwiX3JldHJhbnNtaXQiLCJCb29sZWFuIiwiX3JldHJhbnNtaXRUb1NlbGYiLCJldmVudE5hbWUiLCJmbiIsImVycm9yIiwidXNlcklkIiwiaXNSZWFkQWxsb3dlZCIsImNhbGwiLCJpc0VtaXRBbGxvd2VkIiwiaXNXcml0ZUFsbG93ZWQiLCJhZGRTdWJzY3JpcHRpb24iLCJzdWJzY3JpcHRpb24iLCJyZW1vdmVTdWJzY3JpcHRpb24iLCJ0cmFuc2Zvcm0iLCJhcHBseVRyYW5zZm9ybWVycyIsIm1ldGhvZFNjb3BlIiwidHJhbmZvcm1lZCIsIkFycmF5IiwiaXNBcnJheSIsIl9wdWJsaXNoIiwicHVibGljYXRpb24iLCJvcHRpb25zIiwiTWF0Y2giLCJPbmVPZiIsInVzZUNvbGxlY3Rpb24iLCJzdG9wIiwiRXJyb3IiLCJvblN0b3AiLCJfc2Vzc2lvbiIsInNlbmRBZGRlZCIsInJlYWR5Iiwic3RyZWFtIiwicHVibGlzaCIsIm1ldGhvZCIsInVuYmxvY2siLCJjb25uZWN0aW9uIiwib3JpZ2luYWxQYXJhbXMiLCJfZW1pdCIsIm1ldGhvZHMiLCJlIiwib3JpZ2luIiwiYnJvYWRjYXN0IiwiX19lbWl0IiwiZW1pdFdpdGhvdXRCcm9hZGNhc3QiXSwibWFwcGluZ3MiOiI7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7O0FBQUE7O0FBQ0E7QUFFQUEsRUFBRSxHQUFHLE1BQU1BLEVBQU4sQ0FBUztBQUNiQyxhQUFXLEdBQUc7QUFDYixTQUFLQyxRQUFMLEdBQWdCLEVBQWhCO0FBQ0E7O0FBRURDLE1BQUksQ0FBQ0MsS0FBRCxFQUFpQjtBQUFBLHNDQUFOQyxJQUFNO0FBQU5BLFVBQU07QUFBQTs7QUFDcEIsV0FBTyxLQUFLSCxRQUFMLENBQWNFLEtBQWQsS0FBd0IsS0FBS0YsUUFBTCxDQUFjRSxLQUFkLEVBQXFCRSxPQUFyQixDQUE2QkMsT0FBTyxJQUFJQSxPQUFPLENBQUNDLEtBQVIsQ0FBYyxJQUFkLEVBQW9CSCxJQUFwQixDQUF4QyxDQUEvQjtBQUNBOztBQUVESSxlQUFhLENBQUNMLEtBQUQsRUFBUU0sS0FBUixFQUF3QjtBQUFBLHVDQUFOTCxJQUFN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QUFDQTs7QUE3WDBDLENBQTVDLEMiLCJmaWxlIjoiL3BhY2thZ2VzL3JvY2tldGNoYXRfc3RyZWFtZXIuanMiLCJzb3VyY2VzQ29udGVudCI6WyIvKiBnbG9iYWxzIEVWOnRydWUgKi9cbi8qIGV4cG9ydGVkIEVWICovXG5cbkVWID0gY2xhc3MgRVYge1xuXHRjb25zdHJ1Y3RvcigpIHtcblx0XHR0aGlzLmhhbmRsZXJzID0ge307XG5cdH1cblxuXHRlbWl0KGV2ZW50LCAuLi5hcmdzKSB7XG5cdFx0cmV0dXJuIHRoaXMuaGFuZGxlcnNbZXZlbnRdICYmIHRoaXMuaGFuZGxlcnNbZXZlbnRdLmZvckVhY2goaGFuZGxlciA9PiBoYW5kbGVyLmFwcGx5KHRoaXMsIGFyZ3MpKTtcblx0fVxuXG5cdGVtaXRXaXRoU2NvcGUoZXZlbnQsIHNjb3BlLCAuLi5hcmdzKSB7XG5cdFx0cmV0dXJuIHRoaXMuaGFuZGxlcnNbZXZlbnRdICYmIHRoaXMuaGFuZGxlcnNbZXZlbnRdLmZvckVhY2goaGFuZGxlciA9PiBoYW5kbGVyLmFwcGx5KHNjb3BlLCBhcmdzKSk7XG5cdH1cblxuXHRsaXN0ZW5lckNvdW50KGV2ZW50KSB7XG5cdFx0cmV0dXJuICh0aGlzLmhhbmRsZXJzW2V2ZW50XSAmJiB0aGlzLmhhbmRsZXJzW2V2ZW50XS5sZW5ndGgpIHx8IDA7XG5cdH1cblxuXHRvbihldmVudCwgY2FsbGJhY2spIHtcblx0XHRpZiAoIXRoaXMuaGFuZGxlcnNbZXZlbnRdKSB7XG5cdFx0XHR0aGlzLmhhbmRsZXJzW2V2ZW50XSA9IFtdO1xuXHRcdH1cblx0XHR0aGlzLmhhbmRsZXJzW2V2ZW50XS5wdXNoKGNhbGxiYWNrKTtcblx0fVxuXG5cdG9uY2UoZXZlbnQsIGNhbGxiYWNrKSB7XG5cdFx0Y29uc3Qgc2VsZiA9IHRoaXM7XG5cdFx0dGhpcy5vbihldmVudCwgZnVuY3Rpb24gb25ldGltZUNhbGxiYWNrKCkge1xuXHRcdFx0c2VsZi5yZW1vdmVMaXN0ZW5lcihldmVudCwgb25ldGltZUNhbGxiYWNrKTtcblx0XHRcdGNhbGxiYWNrLmFwcGx5KHRoaXMsIGFyZ3VtZW50cyk7XG5cdFx0fSk7XG5cdH1cblxuXHRyZW1vdmVMaXN0ZW5lcihldmVudCwgY2FsbGJhY2spIHtcblx0XHRpZiAoIXRoaXMuaGFuZGxlcnNbZXZlbnRdKSB7XG5cdFx0XHRyZXR1cm47XG5cdFx0fVxuXHRcdGNvbnN0IGluZGV4ID0gdGhpcy5oYW5kbGVyc1tldmVudF0uaW5kZXhPZihjYWxsYmFjayk7XG5cdFx0aWYgKGluZGV4ID4gLTEpIHtcblx0XHRcdHRoaXMuaGFuZGxlcnNbZXZlbnRdLnNwbGljZShpbmRleCwgMSk7XG5cdFx0fVxuXHR9XG5cblx0cmVtb3ZlQWxsTGlzdGVuZXJzKGV2ZW50KSB7XG5cdFx0dGhpcy5oYW5kbGVyc1tldmVudF0gPSB1bmRlZmluZWQ7XG5cdH1cbn07XG4iLCIvKiBnbG9iYWxzIEVWICovXG4vKiBlc2xpbnQgbmV3LWNhcDogZmFsc2UgKi9cbmltcG9ydCB7IEREUENvbW1vbiB9IGZyb20gJ21ldGVvci9kZHAtY29tbW9uJztcblxuY2xhc3MgU3RyZWFtZXJDZW50cmFsIGV4dGVuZHMgRVYge1xuXHRjb25zdHJ1Y3RvcigpIHtcblx0XHRzdXBlcigpO1xuXG5cdFx0dGhpcy5pbnN0YW5jZXMgPSB7fTtcblx0fVxufVxuXG5NZXRlb3IuU3RyZWFtZXJDZW50cmFsID0gbmV3IFN0cmVhbWVyQ2VudHJhbDtcblxuY29uc3QgY2hhbmdlZFBheWxvYWQgPSBmdW5jdGlvbiAoY29sbGVjdGlvbiwgaWQsIGZpZWxkcykge1xuXHRpZiAoXy5pc0VtcHR5KGZpZWxkcykpIHtcblx0XHRyZXR1cm47XG5cdH1cblx0cmV0dXJuIEREUENvbW1vbi5zdHJpbmdpZnlERFAoe1xuXHRcdG1zZzogJ2NoYW5nZWQnLFxuXHRcdGNvbGxlY3Rpb24sXG5cdFx0aWQsXG5cdFx0ZmllbGRzXG5cdH0pO1xufTtcblxuY29uc3Qgc2VuZCA9IGZ1bmN0aW9uIChzZWxmLCBtc2cpIHtcblx0aWYgKCFzZWxmLnNvY2tldCkge1xuXHRcdHJldHVybjtcblx0fVxuXHRzZWxmLnNvY2tldC5zZW5kKG1zZyk7XG59O1xuXG5cbk1ldGVvci5TdHJlYW1lciA9IGNsYXNzIFN0cmVhbWVyIGV4dGVuZHMgRVYge1xuXHRjb25zdHJ1Y3RvcihuYW1lLCB7cmV0cmFuc21pdCA9IHRydWUsIHJldHJhbnNtaXRUb1NlbGYgPSBmYWxzZX0gPSB7fSkge1xuXHRcdGlmIChNZXRlb3IuU3RyZWFtZXJDZW50cmFsLmluc3RhbmNlc1tuYW1lXSkge1xuXHRcdFx0Y29uc29sZS53YXJuKCdTdHJlYW1lciBpbnN0YW5jZSBhbHJlYWR5IGV4aXN0czonLCBuYW1lKTtcblx0XHRcdHJldHVybiBNZXRlb3IuU3RyZWFtZXJDZW50cmFsLmluc3RhbmNlc1tuYW1lXTtcblx0XHR9XG5cblx0XHRzdXBlcigpO1xuXG5cdFx0TWV0ZW9yLlN0cmVhbWVyQ2VudHJhbC5pbnN0YW5jZXNbbmFtZV0gPSB0aGlzO1xuXG5cdFx0dGhpcy5uYW1lID0gbmFtZTtcblx0XHR0aGlzLnJldHJhbnNtaXQgPSByZXRyYW5zbWl0O1xuXHRcdHRoaXMucmV0cmFuc21pdFRvU2VsZiA9IHJldHJhbnNtaXRUb1NlbGY7XG5cblx0XHR0aGlzLnN1YnNjcmlwdGlvbnMgPSBbXTtcblx0XHR0aGlzLnN1YnNjcmlwdGlvbnNCeUV2ZW50TmFtZSA9IHt9O1xuXHRcdHRoaXMudHJhbnNmb3JtZXJzID0ge307XG5cblx0XHR0aGlzLmluaVB1YmxpY2F0aW9uKCk7XG5cdFx0dGhpcy5pbml0TWV0aG9kKCk7XG5cblx0XHR0aGlzLl9hbGxvd1JlYWQgPSB7fTtcblx0XHR0aGlzLl9hbGxvd0VtaXQgPSB7fTtcblx0XHR0aGlzLl9hbGxvd1dyaXRlID0ge307XG5cblx0XHR0aGlzLmFsbG93UmVhZCgnbm9uZScpO1xuXHRcdHRoaXMuYWxsb3dFbWl0KCdhbGwnKTtcblx0XHR0aGlzLmFsbG93V3JpdGUoJ25vbmUnKTtcblx0fVxuXG5cdGdldCBuYW1lKCkge1xuXHRcdHJldHVybiB0aGlzLl9uYW1lO1xuXHR9XG5cblx0c2V0IG5hbWUobmFtZSkge1xuXHRcdGNoZWNrKG5hbWUsIFN0cmluZyk7XG5cdFx0dGhpcy5fbmFtZSA9IG5hbWU7XG5cdH1cblxuXHRnZXQgc3Vic2NyaXB0aW9uTmFtZSgpIHtcblx0XHRyZXR1cm4gYHN0cmVhbS0ke3RoaXMubmFtZX1gO1xuXHR9XG5cblx0Z2V0IHJldHJhbnNtaXQoKSB7XG5cdFx0cmV0dXJuIHRoaXMuX3JldHJhbnNtaXQ7XG5cdH1cblxuXHRzZXQgcmV0cmFuc21pdChyZXRyYW5zbWl0KSB7XG5cdFx0Y2hlY2socmV0cmFuc21pdCwgQm9vbGVhbik7XG5cdFx0dGhpcy5fcmV0cmFuc21pdCA9IHJldHJhbnNtaXQ7XG5cdH1cblxuXHRnZXQgcmV0cmFuc21pdFRvU2VsZigpIHtcblx0XHRyZXR1cm4gdGhpcy5fcmV0cmFuc21pdFRvU2VsZjtcblx0fVxuXG5cdHNldCByZXRyYW5zbWl0VG9TZWxmKHJldHJhbnNtaXRUb1NlbGYpIHtcblx0XHRjaGVjayhyZXRyYW5zbWl0VG9TZWxmLCBCb29sZWFuKTtcblx0XHR0aGlzLl9yZXRyYW5zbWl0VG9TZWxmID0gcmV0cmFuc21pdFRvU2VsZjtcblx0fVxuXG5cdGFsbG93UmVhZChldmVudE5hbWUsIGZuKSB7XG5cdFx0aWYgKGZuID09PSB1bmRlZmluZWQpIHtcblx0XHRcdGZuID0gZXZlbnROYW1lO1xuXHRcdFx0ZXZlbnROYW1lID0gJ19fYWxsX18nO1xuXHRcdH1cblxuXHRcdGlmICh0eXBlb2YgZm4gPT09ICdmdW5jdGlvbicpIHtcblx0XHRcdHJldHVybiB0aGlzLl9hbGxvd1JlYWRbZXZlbnROYW1lXSA9IGZuO1xuXHRcdH1cblxuXHRcdGlmICh0eXBlb2YgZm4gPT09ICdzdHJpbmcnICYmIFsnYWxsJywgJ25vbmUnLCAnbG9nZ2VkJ10uaW5kZXhPZihmbikgPT09IC0xKSB7XG5cdFx0XHRjb25zb2xlLmVycm9yKGBhbGxvd1JlYWQgc2hvcnRjdXQgJyR7Zm59JyBpcyBpbnZhbGlkYCk7XG5cdFx0fVxuXG5cdFx0aWYgKGZuID09PSAnYWxsJyB8fCBmbiA9PT0gdHJ1ZSkge1xuXHRcdFx0cmV0dXJuIHRoaXMuX2FsbG93UmVhZFtldmVudE5hbWVdID0gZnVuY3Rpb24oKSB7XG5cdFx0XHRcdHJldHVybiB0cnVlO1xuXHRcdFx0fTtcblx0XHR9XG5cblx0XHRpZiAoZm4gPT09ICdub25lJyB8fCBmbiA9PT0gZmFsc2UpIHtcblx0XHRcdHJldHVybiB0aGlzLl9hbGxvd1JlYWRbZXZlbnROYW1lXSA9IGZ1bmN0aW9uKCkge1xuXHRcdFx0XHRyZXR1cm4gZmFsc2U7XG5cdFx0XHR9O1xuXHRcdH1cblxuXHRcdGlmIChmbiA9PT0gJ2xvZ2dlZCcpIHtcblx0XHRcdHJldHVybiB0aGlzLl9hbGxvd1JlYWRbZXZlbnROYW1lXSA9IGZ1bmN0aW9uKCkge1xuXHRcdFx0XHRyZXR1cm4gQm9vbGVhbih0aGlzLnVzZXJJZCk7XG5cdFx0XHR9O1xuXHRcdH1cblx0fVxuXG5cdGFsbG93RW1pdChldmVudE5hbWUsIGZuKSB7XG5cdFx0aWYgKGZuID09PSB1bmRlZmluZWQpIHtcblx0XHRcdGZuID0gZXZlbnROYW1lO1xuXHRcdFx0ZXZlbnROYW1lID0gJ19fYWxsX18nO1xuXHRcdH1cblxuXHRcdGlmICh0eXBlb2YgZm4gPT09ICdmdW5jdGlvbicpIHtcblx0XHRcdHJldHVybiB0aGlzLl9hbGxvd0VtaXRbZXZlbnROYW1lXSA9IGZuO1xuXHRcdH1cblxuXHRcdGlmICh0eXBlb2YgZm4gPT09ICdzdHJpbmcnICYmIFsnYWxsJywgJ25vbmUnLCAnbG9nZ2VkJ10uaW5kZXhPZihmbikgPT09IC0xKSB7XG5cdFx0XHRjb25zb2xlLmVycm9yKGBhbGxvd1JlYWQgc2hvcnRjdXQgJyR7Zm59JyBpcyBpbnZhbGlkYCk7XG5cdFx0fVxuXG5cdFx0aWYgKGZuID09PSAnYWxsJyB8fCBmbiA9PT0gdHJ1ZSkge1xuXHRcdFx0cmV0dXJuIHRoaXMuX2FsbG93RW1pdFtldmVudE5hbWVdID0gZnVuY3Rpb24oKSB7XG5cdFx0XHRcdHJldHVybiB0cnVlO1xuXHRcdFx0fTtcblx0XHR9XG5cblx0XHRpZiAoZm4gPT09ICdub25lJyB8fCBmbiA9PT0gZmFsc2UpIHtcblx0XHRcdHJldHVybiB0aGlzLl9hbGxvd0VtaXRbZXZlbnROYW1lXSA9IGZ1bmN0aW9uKCkge1xuXHRcdFx0XHRyZXR1cm4gZmFsc2U7XG5cdFx0XHR9O1xuXHRcdH1cblxuXHRcdGlmIChmbiA9PT0gJ2xvZ2dlZCcpIHtcblx0XHRcdHJldHVybiB0aGlzLl9hbGxvd0VtaXRbZXZlbnROYW1lXSA9IGZ1bmN0aW9uKCkge1xuXHRcdFx0XHRyZXR1cm4gQm9vbGVhbih0aGlzLnVzZXJJZCk7XG5cdFx0XHR9O1xuXHRcdH1cblx0fVxuXG5cdGFsbG93V3JpdGUoZXZlbnROYW1lLCBmbikge1xuXHRcdGlmIChmbiA9PT0gdW5kZWZpbmVkKSB7XG5cdFx0XHRmbiA9IGV2ZW50TmFtZTtcblx0XHRcdGV2ZW50TmFtZSA9ICdfX2FsbF9fJztcblx0XHR9XG5cblx0XHRpZiAodHlwZW9mIGZuID09PSAnZnVuY3Rpb24nKSB7XG5cdFx0XHRyZXR1cm4gdGhpcy5fYWxsb3dXcml0ZVtldmVudE5hbWVdID0gZm47XG5cdFx0fVxuXG5cdFx0aWYgKHR5cGVvZiBmbiA9PT0gJ3N0cmluZycgJiYgWydhbGwnLCAnbm9uZScsICdsb2dnZWQnXS5pbmRleE9mKGZuKSA9PT0gLTEpIHtcblx0XHRcdGNvbnNvbGUuZXJyb3IoYGFsbG93V3JpdGUgc2hvcnRjdXQgJyR7Zm59JyBpcyBpbnZhbGlkYCk7XG5cdFx0fVxuXG5cdFx0aWYgKGZuID09PSAnYWxsJyB8fCBmbiA9PT0gdHJ1ZSkge1xuXHRcdFx0cmV0dXJuIHRoaXMuX2FsbG93V3JpdGVbZXZlbnROYW1lXSA9IGZ1bmN0aW9uKCkge1xuXHRcdFx0XHRyZXR1cm4gdHJ1ZTtcblx0XHRcdH07XG5cdFx0fVxuXG5cdFx0aWYgKGZuID09PSAnbm9uZScgfHwgZm4gPT09IGZhbHNlKSB7XG5cdFx0XHRyZXR1cm4gdGhpcy5fYWxsb3dXcml0ZVtldmVudE5hbWVdID0gZnVuY3Rpb24oKSB7XG5cdFx0XHRcdHJldHVybiBmYWxzZTtcblx0XHRcdH07XG5cdFx0fVxuXG5cdFx0aWYgKGZuID09PSAnbG9nZ2VkJykge1xuXHRcdFx0cmV0dXJuIHRoaXMuX2FsbG93V3JpdGVbZXZlbnROYW1lXSA9IGZ1bmN0aW9uKCkge1xuXHRcdFx0XHRyZXR1cm4gQm9vbGVhbih0aGlzLnVzZXJJZCk7XG5cdFx0XHR9O1xuXHRcdH1cblx0fVxuXG5cdGlzUmVhZEFsbG93ZWQoc2NvcGUsIGV2ZW50TmFtZSwgYXJncykge1xuXHRcdGlmICh0aGlzLl9hbGxvd1JlYWRbZXZlbnROYW1lXSkge1xuXHRcdFx0cmV0dXJuIHRoaXMuX2FsbG93UmVhZFtldmVudE5hbWVdLmNhbGwoc2NvcGUsIGV2ZW50TmFtZSwgLi4uYXJncyk7XG5cdFx0fVxuXG5cdFx0cmV0dXJuIHRoaXMuX2FsbG93UmVhZFsnX19hbGxfXyddLmNhbGwoc2NvcGUsIGV2ZW50TmFtZSwgLi4uYXJncyk7XG5cdH1cblxuXHRpc0VtaXRBbGxvd2VkKHNjb3BlLCBldmVudE5hbWUsIC4uLmFyZ3MpIHtcblx0XHRpZiAodGhpcy5fYWxsb3dFbWl0W2V2ZW50TmFtZV0pIHtcblx0XHRcdHJldHVybiB0aGlzLl9hbGxvd0VtaXRbZXZlbnROYW1lXS5jYWxsKHNjb3BlLCBldmVudE5hbWUsIC4uLmFyZ3MpO1xuXHRcdH1cblxuXHRcdHJldHVybiB0aGlzLl9hbGxvd0VtaXRbJ19fYWxsX18nXS5jYWxsKHNjb3BlLCBldmVudE5hbWUsIC4uLmFyZ3MpO1xuXHR9XG5cblx0aXNXcml0ZUFsbG93ZWQoc2NvcGUsIGV2ZW50TmFtZSwgYXJncykge1xuXHRcdGlmICh0aGlzLl9hbGxvd1dyaXRlW2V2ZW50TmFtZV0pIHtcblx0XHRcdHJldHVybiB0aGlzLl9hbGxvd1dyaXRlW2V2ZW50TmFtZV0uY2FsbChzY29wZSwgZXZlbnROYW1lLCAuLi5hcmdzKTtcblx0XHR9XG5cblx0XHRyZXR1cm4gdGhpcy5fYWxsb3dXcml0ZVsnX19hbGxfXyddLmNhbGwoc2NvcGUsIGV2ZW50TmFtZSwgLi4uYXJncyk7XG5cdH1cblxuXHRhZGRTdWJzY3JpcHRpb24oc3Vic2NyaXB0aW9uLCBldmVudE5hbWUpIHtcblx0XHR0aGlzLnN1YnNjcmlwdGlvbnMucHVzaChzdWJzY3JpcHRpb24pO1xuXG5cdFx0aWYgKCF0aGlzLnN1YnNjcmlwdGlvbnNCeUV2ZW50TmFtZVtldmVudE5hbWVdKSB7XG5cdFx0XHR0aGlzLnN1YnNjcmlwdGlvbnNCeUV2ZW50TmFtZVtldmVudE5hbWVdID0gW107XG5cdFx0fVxuXG5cdFx0dGhpcy5zdWJzY3JpcHRpb25zQnlFdmVudE5hbWVbZXZlbnROYW1lXS5wdXNoKHN1YnNjcmlwdGlvbik7XG5cdH1cblxuXHRyZW1vdmVTdWJzY3JpcHRpb24oc3Vic2NyaXB0aW9uLCBldmVudE5hbWUpIHtcblx0XHRjb25zdCBpbmRleCA9IHRoaXMuc3Vic2NyaXB0aW9ucy5pbmRleE9mKHN1YnNjcmlwdGlvbik7XG5cdFx0aWYgKGluZGV4ID4gLTEpIHtcblx0XHRcdHRoaXMuc3Vic2NyaXB0aW9ucy5zcGxpY2UoaW5kZXgsIDEpO1xuXHRcdH1cblxuXHRcdGlmICh0aGlzLnN1YnNjcmlwdGlvbnNCeUV2ZW50TmFtZVtldmVudE5hbWVdKSB7XG5cdFx0XHRjb25zdCBpbmRleCA9IHRoaXMuc3Vic2NyaXB0aW9uc0J5RXZlbnROYW1lW2V2ZW50TmFtZV0uaW5kZXhPZihzdWJzY3JpcHRpb24pO1xuXHRcdFx0aWYgKGluZGV4ID4gLTEpIHtcblx0XHRcdFx0dGhpcy5zdWJzY3JpcHRpb25zQnlFdmVudE5hbWVbZXZlbnROYW1lXS5zcGxpY2UoaW5kZXgsIDEpO1xuXHRcdFx0fVxuXHRcdH1cblx0fVxuXG5cdHRyYW5zZm9ybShldmVudE5hbWUsIGZuKSB7XG5cdFx0aWYgKHR5cGVvZiBldmVudE5hbWUgPT09ICdmdW5jdGlvbicpIHtcblx0XHRcdGZuID0gZXZlbnROYW1lO1xuXHRcdFx0ZXZlbnROYW1lID0gJ19fYWxsX18nO1xuXHRcdH1cblxuXHRcdGlmICghdGhpcy50cmFuc2Zvcm1lcnNbZXZlbnROYW1lXSkge1xuXHRcdFx0dGhpcy50cmFuc2Zvcm1lcnNbZXZlbnROYW1lXSA9IFtdO1xuXHRcdH1cblxuXHRcdHRoaXMudHJhbnNmb3JtZXJzW2V2ZW50TmFtZV0ucHVzaChmbik7XG5cdH1cblxuXHRhcHBseVRyYW5zZm9ybWVycyhtZXRob2RTY29wZSwgZXZlbnROYW1lLCBhcmdzKSB7XG5cdFx0aWYgKHRoaXMudHJhbnNmb3JtZXJzWydfX2FsbF9fJ10pIHtcblx0XHRcdHRoaXMudHJhbnNmb3JtZXJzWydfX2FsbF9fJ10uZm9yRWFjaCgodHJhbnNmb3JtKSA9PiB7XG5cdFx0XHRcdGFyZ3MgPSB0cmFuc2Zvcm0uY2FsbChtZXRob2RTY29wZSwgZXZlbnROYW1lLCBhcmdzKTtcblx0XHRcdFx0bWV0aG9kU2NvcGUudHJhbmZvcm1lZCA9IHRydWU7XG5cdFx0XHRcdGlmICghQXJyYXkuaXNBcnJheShhcmdzKSkge1xuXHRcdFx0XHRcdGFyZ3MgPSBbYXJnc107XG5cdFx0XHRcdH1cblx0XHRcdH0pO1xuXHRcdH1cblxuXHRcdGlmICh0aGlzLnRyYW5zZm9ybWVyc1tldmVudE5hbWVdKSB7XG5cdFx0XHR0aGlzLnRyYW5zZm9ybWVyc1tldmVudE5hbWVdLmZvckVhY2goKHRyYW5zZm9ybSkgPT4ge1xuXHRcdFx0XHRhcmdzID0gdHJhbnNmb3JtLmNhbGwobWV0aG9kU2NvcGUsIC4uLmFyZ3MpO1xuXHRcdFx0XHRtZXRob2RTY29wZS50cmFuZm9ybWVkID0gdHJ1ZTtcblx0XHRcdFx0aWYgKCFBcnJheS5pc0FycmF5KGFyZ3MpKSB7XG5cdFx0XHRcdFx0YXJncyA9IFthcmdzXTtcblx0XHRcdFx0fVxuXHRcdFx0fSk7XG5cdFx0fVxuXG5cdFx0cmV0dXJuIGFyZ3M7XG5cdH1cblxuXG5cdF9wdWJsaXNoKHB1YmxpY2F0aW9uLCBldmVudE5hbWUsIG9wdGlvbnMpIHtcblx0XHRjaGVjayhldmVudE5hbWUsIFN0cmluZyk7XG5cdFx0Y2hlY2sob3B0aW9ucywgTWF0Y2guT25lT2YoQm9vbGVhbiwge1xuXHRcdFx0dXNlQ29sbGVjdGlvbjogQm9vbGVhbixcblx0XHRcdGFyZ3M6IEFycmF5LFxuXHRcdH0pKTtcblxuXHRcdGxldCB1c2VDb2xsZWN0aW9uLCBhcmdzID0gW107XG5cblx0XHRpZiAodHlwZW9mIG9wdGlvbnMgPT09ICdib29sZWFuJykge1xuXHRcdFx0dXNlQ29sbGVjdGlvbiA9IG9wdGlvbnM7XG5cdFx0fSBlbHNlIHtcblx0XHRcdGlmIChvcHRpb25zLnVzZUNvbGxlY3Rpb24pIHtcblx0XHRcdFx0dXNlQ29sbGVjdGlvbiA9IG9wdGlvbnMudXNlQ29sbGVjdGlvbjtcblx0XHRcdH1cblxuXHRcdFx0aWYgKG9wdGlvbnMuYXJncykge1xuXHRcdFx0XHRhcmdzID0gb3B0aW9ucy5hcmdzO1xuXHRcdFx0fVxuXHRcdH1cblxuXHRcdGlmIChldmVudE5hbWUubGVuZ3RoID09PSAwKSB7XG5cdFx0XHRwdWJsaWNhdGlvbi5zdG9wKCk7XG5cdFx0XHR0aHJvdyBuZXcgTWV0ZW9yLkVycm9yKCdpbnZhbGlkLWV2ZW50LW5hbWUnKTtcblx0XHR9XG5cblx0XHRpZiAodGhpcy5pc1JlYWRBbGxvd2VkKHB1YmxpY2F0aW9uLCBldmVudE5hbWUsIGFyZ3MpICE9PSB0cnVlKSB7XG5cdFx0XHRwdWJsaWNhdGlvbi5zdG9wKCk7XG5cdFx0XHR0aHJvdyBuZXcgTWV0ZW9yLkVycm9yKCdub3QtYWxsb3dlZCcpO1xuXHRcdH1cblxuXHRcdGNvbnN0IHN1YnNjcmlwdGlvbiA9IHtcblx0XHRcdHN1YnNjcmlwdGlvbjogcHVibGljYXRpb24sXG5cdFx0XHRldmVudE5hbWU6IGV2ZW50TmFtZVxuXHRcdH07XG5cblx0XHR0aGlzLmFkZFN1YnNjcmlwdGlvbihzdWJzY3JpcHRpb24sIGV2ZW50TmFtZSk7XG5cblx0XHRwdWJsaWNhdGlvbi5vblN0b3AoKCkgPT4ge1xuXHRcdFx0dGhpcy5yZW1vdmVTdWJzY3JpcHRpb24oc3Vic2NyaXB0aW9uLCBldmVudE5hbWUpO1xuXHRcdH0pO1xuXG5cdFx0aWYgKHVzZUNvbGxlY3Rpb24gPT09IHRydWUpIHtcblx0XHRcdC8vIENvbGxlY3Rpb24gY29tcGF0aWJpbGl0eVxuXHRcdFx0cHVibGljYXRpb24uX3Nlc3Npb24uc2VuZEFkZGVkKHRoaXMuc3Vic2NyaXB0aW9uTmFtZSwgJ2lkJywge1xuXHRcdFx0XHRldmVudE5hbWU6IGV2ZW50TmFtZVxuXHRcdFx0fSk7XG5cdFx0fVxuXG5cdFx0cHVibGljYXRpb24ucmVhZHkoKTtcblx0fVxuXG5cdGluaVB1YmxpY2F0aW9uKCkge1xuXHRcdGNvbnN0IHN0cmVhbSA9IHRoaXM7XG5cdFx0TWV0ZW9yLnB1Ymxpc2godGhpcy5zdWJzY3JpcHRpb25OYW1lLCBmdW5jdGlvbiAoLi4uYXJncykgeyByZXR1cm4gc3RyZWFtLl9wdWJsaXNoLmFwcGx5KHN0cmVhbSwgW3RoaXMsIC4uLmFyZ3NdKTsgfSk7XG5cdH1cblxuXHRpbml0TWV0aG9kKCkge1xuXHRcdGNvbnN0IHN0cmVhbSA9IHRoaXM7XG5cdFx0Y29uc3QgbWV0aG9kID0ge307XG5cblx0XHRtZXRob2RbdGhpcy5zdWJzY3JpcHRpb25OYW1lXSA9IGZ1bmN0aW9uKGV2ZW50TmFtZSwgLi4uYXJncykge1xuXHRcdFx0Y2hlY2soZXZlbnROYW1lLCBTdHJpbmcpO1xuXHRcdFx0Y2hlY2soYXJncywgQXJyYXkpO1xuXG5cdFx0XHR0aGlzLnVuYmxvY2soKTtcblxuXHRcdFx0aWYgKHN0cmVhbS5pc1dyaXRlQWxsb3dlZCh0aGlzLCBldmVudE5hbWUsIGFyZ3MpICE9PSB0cnVlKSB7XG5cdFx0XHRcdHJldHVybjtcblx0XHRcdH1cblxuXHRcdFx0Y29uc3QgbWV0aG9kU2NvcGUgPSB7XG5cdFx0XHRcdHVzZXJJZDogdGhpcy51c2VySWQsXG5cdFx0XHRcdGNvbm5lY3Rpb246IHRoaXMuY29ubmVjdGlvbixcblx0XHRcdFx0b3JpZ2luYWxQYXJhbXM6IGFyZ3MsXG5cdFx0XHRcdHRyYW5mb3JtZWQ6IGZhbHNlXG5cdFx0XHR9O1xuXG5cdFx0XHRhcmdzID0gc3RyZWFtLmFwcGx5VHJhbnNmb3JtZXJzKG1ldGhvZFNjb3BlLCBldmVudE5hbWUsIGFyZ3MpO1xuXG5cdFx0XHRzdHJlYW0uZW1pdFdpdGhTY29wZShldmVudE5hbWUsIG1ldGhvZFNjb3BlLCAuLi5hcmdzKTtcblxuXHRcdFx0aWYgKHN0cmVhbS5yZXRyYW5zbWl0ID09PSB0cnVlKSB7XG5cdFx0XHRcdHN0cmVhbS5fZW1pdChldmVudE5hbWUsIGFyZ3MsIHRoaXMuY29ubmVjdGlvbiwgdHJ1ZSk7XG5cdFx0XHR9XG5cdFx0fTtcblxuXHRcdHRyeSB7XG5cdFx0XHRNZXRlb3IubWV0aG9kcyhtZXRob2QpO1xuXHRcdH0gY2F0Y2ggKGUpIHtcblx0XHRcdGNvbnNvbGUuZXJyb3IoZSk7XG5cdFx0fVxuXHR9XG5cblx0X2VtaXQoZXZlbnROYW1lLCBhcmdzLCBvcmlnaW4sIGJyb2FkY2FzdCkge1xuXHRcdGlmIChicm9hZGNhc3QgPT09IHRydWUpIHtcblx0XHRcdE1ldGVvci5TdHJlYW1lckNlbnRyYWwuZW1pdCgnYnJvYWRjYXN0JywgdGhpcy5uYW1lLCBldmVudE5hbWUsIGFyZ3MpO1xuXHRcdH1cblxuXHRcdGNvbnN0IHN1YnNjcmlwdGlvbnMgPSB0aGlzLnN1YnNjcmlwdGlvbnNCeUV2ZW50TmFtZVtldmVudE5hbWVdO1xuXHRcdGlmICghQXJyYXkuaXNBcnJheShzdWJzY3JpcHRpb25zKSkge1xuXHRcdFx0cmV0dXJuO1xuXHRcdH1cblxuXHRcdGNvbnN0IG1zZyA9IGNoYW5nZWRQYXlsb2FkKHRoaXMuc3Vic2NyaXB0aW9uTmFtZSwgJ2lkJywge1xuXHRcdFx0ZXZlbnROYW1lLFxuXHRcdFx0YXJnc1xuXHRcdH0pO1xuXG5cdFx0aWYoIW1zZykge1xuXHRcdFx0cmV0dXJuO1xuXHRcdH1cblxuXHRcdHN1YnNjcmlwdGlvbnMuZm9yRWFjaCgoc3Vic2NyaXB0aW9uKSA9PiB7XG5cdFx0XHRpZiAodGhpcy5yZXRyYW5zbWl0VG9TZWxmID09PSBmYWxzZSAmJiBvcmlnaW4gJiYgb3JpZ2luID09PSBzdWJzY3JpcHRpb24uc3Vic2NyaXB0aW9uLmNvbm5lY3Rpb24pIHtcblx0XHRcdFx0cmV0dXJuO1xuXHRcdFx0fVxuXG5cdFx0XHRpZiAodGhpcy5pc0VtaXRBbGxvd2VkKHN1YnNjcmlwdGlvbi5zdWJzY3JpcHRpb24sIGV2ZW50TmFtZSwgLi4uYXJncykpIHtcblx0XHRcdFx0c2VuZChzdWJzY3JpcHRpb24uc3Vic2NyaXB0aW9uLl9zZXNzaW9uLCBtc2cpO1xuXHRcdFx0fVxuXHRcdH0pO1xuXHR9XG5cblx0ZW1pdChldmVudE5hbWUsIC4uLmFyZ3MpIHtcblx0XHR0aGlzLl9lbWl0KGV2ZW50TmFtZSwgYXJncywgdW5kZWZpbmVkLCB0cnVlKTtcblx0fVxuXG5cdF9fZW1pdCguLi5hcmdzKSB7XG5cdFx0cmV0dXJuIHN1cGVyLmVtaXQoLi4uYXJncyk7XG5cdH1cblxuXHRlbWl0V2l0aG91dEJyb2FkY2FzdChldmVudE5hbWUsIC4uLmFyZ3MpIHtcblx0XHR0aGlzLl9lbWl0KGV2ZW50TmFtZSwgYXJncywgdW5kZWZpbmVkLCBmYWxzZSk7XG5cdH1cbn07XG4iXX0=
