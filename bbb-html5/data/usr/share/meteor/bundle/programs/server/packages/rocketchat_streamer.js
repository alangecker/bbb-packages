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
var meteorBabelHelpers = Package['babel-runtime'].meteorBabelHelpers;
var Promise = Package.promise.Promise;

/* Package-scope variables */
var EV, fn, eventName, args, Streamer;

var require = meteorInstall({"node_modules":{"meteor":{"rocketchat:streamer":{"lib":{"ev.js":function(){

////////////////////////////////////////////////////////////////////////////////////////////////////////////
//                                                                                                        //
// packages/rocketchat_streamer/lib/ev.js                                                                 //
//                                                                                                        //
////////////////////////////////////////////////////////////////////////////////////////////////////////////
                                                                                                          //
/* globals EV:true */

/* exported EV */
EV = class EV {
  constructor() {
    this.handlers = {};
  }

  emit(event, ...args) {
    return this.handlers[event] && this.handlers[event].forEach(handler => handler.apply(this, args));
  }

  emitWithScope(event, scope, ...args) {
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
////////////////////////////////////////////////////////////////////////////////////////////////////////////

}},"server":{"server.js":function(require,exports,module){

////////////////////////////////////////////////////////////////////////////////////////////////////////////
//                                                                                                        //
// packages/rocketchat_streamer/server/server.js                                                          //
//                                                                                                        //
////////////////////////////////////////////////////////////////////////////////////////////////////////////
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
  constructor(name, {
    retransmit = true,
    retransmitToSelf = false
  } = {}) {
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
    return `stream-${this.name}`;
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
      console.error(`allowRead shortcut '${fn}' is invalid`);
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
      console.error(`allowRead shortcut '${fn}' is invalid`);
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
      console.error(`allowWrite shortcut '${fn}' is invalid`);
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

  isEmitAllowed(scope, eventName, ...args) {
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
    Meteor.publish(this.subscriptionName, function (...args) {
      return stream._publish.apply(stream, [this, ...args]);
    });
  }

  initMethod() {
    const stream = this;
    const method = {};

    method[this.subscriptionName] = function (eventName, ...args) {
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

  emit(eventName, ...args) {
    this._emit(eventName, args, undefined, true);
  }

  __emit(...args) {
    return super.emit(...args);
  }

  emitWithoutBroadcast(eventName, ...args) {
    this._emit(eventName, args, undefined, false);
  }

};
////////////////////////////////////////////////////////////////////////////////////////////////////////////

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
//# sourceMappingURL=data:application/json;charset=utf8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIm1ldGVvcjovL/CfkrthcHAvcGFja2FnZXMvcm9ja2V0Y2hhdDpzdHJlYW1lci9saWIvZXYuanMiLCJtZXRlb3I6Ly/wn5K7YXBwL3BhY2thZ2VzL3JvY2tldGNoYXQ6c3RyZWFtZXIvc2VydmVyL3NlcnZlci5qcyJdLCJuYW1lcyI6WyJFViIsImNvbnN0cnVjdG9yIiwiaGFuZGxlcnMiLCJlbWl0IiwiZXZlbnQiLCJhcmdzIiwiZm9yRWFjaCIsImhhbmRsZXIiLCJhcHBseSIsImVtaXRXaXRoU2NvcGUiLCJzY29wZSIsImxpc3RlbmVyQ291bnQiLCJsZW5ndGgiLCJvbiIsImNhbGxiYWNrIiwicHVzaCIsIm9uY2UiLCJzZWxmIiwib25ldGltZUNhbGxiYWNrIiwicmVtb3ZlTGlzdGVuZXIiLCJhcmd1bWVudHMiLCJpbmRleCIsImluZGV4T2YiLCJzcGxpY2UiLCJyZW1vdmVBbGxMaXN0ZW5lcnMiLCJ1bmRlZmluZWQiLCJERFBDb21tb24iLCJtb2R1bGUiLCJsaW5rIiwidiIsIlN0cmVhbWVyQ2VudHJhbCIsImluc3RhbmNlcyIsIk1ldGVvciIsImNoYW5nZWRQYXlsb2FkIiwiY29sbGVjdGlvbiIsImlkIiwiZmllbGRzIiwiXyIsImlzRW1wdHkiLCJzdHJpbmdpZnlERFAiLCJtc2ciLCJzZW5kIiwic29ja2V0IiwiU3RyZWFtZXIiLCJuYW1lIiwicmV0cmFuc21pdCIsInJldHJhbnNtaXRUb1NlbGYiLCJjb25zb2xlIiwid2FybiIsInN1YnNjcmlwdGlvbnMiLCJzdWJzY3JpcHRpb25zQnlFdmVudE5hbWUiLCJ0cmFuc2Zvcm1lcnMiLCJpbmlQdWJsaWNhdGlvbiIsImluaXRNZXRob2QiLCJfYWxsb3dSZWFkIiwiX2FsbG93RW1pdCIsIl9hbGxvd1dyaXRlIiwiYWxsb3dSZWFkIiwiYWxsb3dFbWl0IiwiYWxsb3dXcml0ZSIsIl9uYW1lIiwiY2hlY2siLCJTdHJpbmciLCJzdWJzY3JpcHRpb25OYW1lIiwiX3JldHJhbnNtaXQiLCJCb29sZWFuIiwiX3JldHJhbnNtaXRUb1NlbGYiLCJldmVudE5hbWUiLCJmbiIsImVycm9yIiwidXNlcklkIiwiaXNSZWFkQWxsb3dlZCIsImNhbGwiLCJpc0VtaXRBbGxvd2VkIiwiaXNXcml0ZUFsbG93ZWQiLCJhZGRTdWJzY3JpcHRpb24iLCJzdWJzY3JpcHRpb24iLCJyZW1vdmVTdWJzY3JpcHRpb24iLCJ0cmFuc2Zvcm0iLCJhcHBseVRyYW5zZm9ybWVycyIsIm1ldGhvZFNjb3BlIiwidHJhbmZvcm1lZCIsIkFycmF5IiwiaXNBcnJheSIsIl9wdWJsaXNoIiwicHVibGljYXRpb24iLCJvcHRpb25zIiwiTWF0Y2giLCJPbmVPZiIsInVzZUNvbGxlY3Rpb24iLCJzdG9wIiwiRXJyb3IiLCJvblN0b3AiLCJfc2Vzc2lvbiIsInNlbmRBZGRlZCIsInJlYWR5Iiwic3RyZWFtIiwicHVibGlzaCIsIm1ldGhvZCIsInVuYmxvY2siLCJjb25uZWN0aW9uIiwib3JpZ2luYWxQYXJhbXMiLCJfZW1pdCIsIm1ldGhvZHMiLCJlIiwib3JpZ2luIiwiYnJvYWRjYXN0IiwiX19lbWl0IiwiZW1pdFdpdGhvdXRCcm9hZGNhc3QiXSwibWFwcGluZ3MiOiI7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7OztBQUFBOztBQUNBO0FBRUFBLEVBQUUsR0FBRyxNQUFNQSxFQUFOLENBQVM7QUFDYkMsYUFBVyxHQUFHO0FBQ2IsU0FBS0MsUUFBTCxHQUFnQixFQUFoQjtBQUNBOztBQUVEQyxNQUFJLENBQUNDLEtBQUQsRUFBUSxHQUFHQyxJQUFYLEVBQWlCO0FBQ3BCLFdBQU8sS0FBS0gsUUFBTCxDQUFjRSxLQUFkLEtBQXdCLEtBQUtGLFFBQUwsQ0FBY0UsS0FBZCxFQUFxQkUsT0FBckIsQ0FBNkJDLE9BQU8sSUFBSUEsT0FBTyxDQUFDQyxLQUFSLENBQWMsSUFBZCxFQUFvQkgsSUFBcEIsQ0FBeEMsQ0FBL0I7QUFDQTs7QUFFREksZUFBYSxDQUFDTCxLQUFELEVBQVFNLEtBQVIsRUFBZSxHQUFHTCxJQUFsQixFQUF3QjtBQUNwQyxXQUFPLEtBQUtI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b250ZW50IjpbIi8qIGdsb2JhbHMgRVY6dHJ1ZSAqL1xuLyogZXhwb3J0ZWQgRVYgKi9cblxuRVYgPSBjbGFzcyBFViB7XG5cdGNvbnN0cnVjdG9yKCkge1xuXHRcdHRoaXMuaGFuZGxlcnMgPSB7fTtcblx0fVxuXG5cdGVtaXQoZXZlbnQsIC4uLmFyZ3MpIHtcblx0XHRyZXR1cm4gdGhpcy5oYW5kbGVyc1tldmVudF0gJiYgdGhpcy5oYW5kbGVyc1tldmVudF0uZm9yRWFjaChoYW5kbGVyID0+IGhhbmRsZXIuYXBwbHkodGhpcywgYXJncykpO1xuXHR9XG5cblx0ZW1pdFdpdGhTY29wZShldmVudCwgc2NvcGUsIC4uLmFyZ3MpIHtcblx0XHRyZXR1cm4gdGhpcy5oYW5kbGVyc1tldmVudF0gJiYgdGhpcy5oYW5kbGVyc1tldmVudF0uZm9yRWFjaChoYW5kbGVyID0+IGhhbmRsZXIuYXBwbHkoc2NvcGUsIGFyZ3MpKTtcblx0fVxuXG5cdGxpc3RlbmVyQ291bnQoZXZlbnQpIHtcblx0XHRyZXR1cm4gKHRoaXMuaGFuZGxlcnNbZXZlbnRdICYmIHRoaXMuaGFuZGxlcnNbZXZlbnRdLmxlbmd0aCkgfHwgMDtcblx0fVxuXG5cdG9uKGV2ZW50LCBjYWxsYmFjaykge1xuXHRcdGlmICghdGhpcy5oYW5kbGVyc1tldmVudF0pIHtcblx0XHRcdHRoaXMuaGFuZGxlcnNbZXZlbnRdID0gW107XG5cdFx0fVxuXHRcdHRoaXMuaGFuZGxlcnNbZXZlbnRdLnB1c2goY2FsbGJhY2spO1xuXHR9XG5cblx0b25jZShldmVudCwgY2FsbGJhY2spIHtcblx0XHRjb25zdCBzZWxmID0gdGhpcztcblx0XHR0aGlzLm9uKGV2ZW50LCBmdW5jdGlvbiBvbmV0aW1lQ2FsbGJhY2soKSB7XG5cdFx0XHRzZWxmLnJlbW92ZUxpc3RlbmVyKGV2ZW50LCBvbmV0aW1lQ2FsbGJhY2spO1xuXHRcdFx0Y2FsbGJhY2suYXBwbHkodGhpcywgYXJndW1lbnRzKTtcblx0XHR9KTtcblx0fVxuXG5cdHJlbW92ZUxpc3RlbmVyKGV2ZW50LCBjYWxsYmFjaykge1xuXHRcdGlmICghdGhpcy5oYW5kbGVyc1tldmVudF0pIHtcblx0XHRcdHJldHVybjtcblx0XHR9XG5cdFx0Y29uc3QgaW5kZXggPSB0aGlzLmhhbmRsZXJzW2V2ZW50XS5pbmRleE9mKGNhbGxiYWNrKTtcblx0XHRpZiAoaW5kZXggPiAtMSkge1xuXHRcdFx0dGhpcy5oYW5kbGVyc1tldmVudF0uc3BsaWNlKGluZGV4LCAxKTtcblx0XHR9XG5cdH1cblxuXHRyZW1vdmVBbGxMaXN0ZW5lcnMoZXZlbnQpIHtcblx0XHR0aGlzLmhhbmRsZXJzW2V2ZW50XSA9IHVuZGVmaW5lZDtcblx0fVxufTtcbiIsIi8qIGdsb2JhbHMgRVYgKi9cbi8qIGVzbGludCBuZXctY2FwOiBmYWxzZSAqL1xuaW1wb3J0IHsgRERQQ29tbW9uIH0gZnJvbSAnbWV0ZW9yL2RkcC1jb21tb24nO1xuXG5jbGFzcyBTdHJlYW1lckNlbnRyYWwgZXh0ZW5kcyBFViB7XG5cdGNvbnN0cnVjdG9yKCkge1xuXHRcdHN1cGVyKCk7XG5cblx0XHR0aGlzLmluc3RhbmNlcyA9IHt9O1xuXHR9XG59XG5cbk1ldGVvci5TdHJlYW1lckNlbnRyYWwgPSBuZXcgU3RyZWFtZXJDZW50cmFsO1xuXG5jb25zdCBjaGFuZ2VkUGF5bG9hZCA9IGZ1bmN0aW9uIChjb2xsZWN0aW9uLCBpZCwgZmllbGRzKSB7XG5cdGlmIChfLmlzRW1wdHkoZmllbGRzKSkge1xuXHRcdHJldHVybjtcblx0fVxuXHRyZXR1cm4gRERQQ29tbW9uLnN0cmluZ2lmeUREUCh7XG5cdFx0bXNnOiAnY2hhbmdlZCcsXG5cdFx0Y29sbGVjdGlvbixcblx0XHRpZCxcblx0XHRmaWVsZHNcblx0fSk7XG59O1xuXG5jb25zdCBzZW5kID0gZnVuY3Rpb24gKHNlbGYsIG1zZykge1xuXHRpZiAoIXNlbGYuc29ja2V0KSB7XG5cdFx0cmV0dXJuO1xuXHR9XG5cdHNlbGYuc29ja2V0LnNlbmQobXNnKTtcbn07XG5cblxuTWV0ZW9yLlN0cmVhbWVyID0gY2xhc3MgU3RyZWFtZXIgZXh0ZW5kcyBFViB7XG5cdGNvbnN0cnVjdG9yKG5hbWUsIHtyZXRyYW5zbWl0ID0gdHJ1ZSwgcmV0cmFuc21pdFRvU2VsZiA9IGZhbHNlfSA9IHt9KSB7XG5cdFx0aWYgKE1ldGVvci5TdHJlYW1lckNlbnRyYWwuaW5zdGFuY2VzW25hbWVdKSB7XG5cdFx0XHRjb25zb2xlLndhcm4oJ1N0cmVhbWVyIGluc3RhbmNlIGFscmVhZHkgZXhpc3RzOicsIG5hbWUpO1xuXHRcdFx0cmV0dXJuIE1ldGVvci5TdHJlYW1lckNlbnRyYWwuaW5zdGFuY2VzW25hbWVdO1xuXHRcdH1cblxuXHRcdHN1cGVyKCk7XG5cblx0XHRNZXRlb3IuU3RyZWFtZXJDZW50cmFsLmluc3RhbmNlc1tuYW1lXSA9IHRoaXM7XG5cblx0XHR0aGlzLm5hbWUgPSBuYW1lO1xuXHRcdHRoaXMucmV0cmFuc21pdCA9IHJldHJhbnNtaXQ7XG5cdFx0dGhpcy5yZXRyYW5zbWl0VG9TZWxmID0gcmV0cmFuc21pdFRvU2VsZjtcblxuXHRcdHRoaXMuc3Vic2NyaXB0aW9ucyA9IFtdO1xuXHRcdHRoaXMuc3Vic2NyaXB0aW9uc0J5RXZlbnROYW1lID0ge307XG5cdFx0dGhpcy50cmFuc2Zvcm1lcnMgPSB7fTtcblxuXHRcdHRoaXMuaW5pUHVibGljYXRpb24oKTtcblx0XHR0aGlzLmluaXRNZXRob2QoKTtcblxuXHRcdHRoaXMuX2FsbG93UmVhZCA9IHt9O1xuXHRcdHRoaXMuX2FsbG93RW1pdCA9IHt9O1xuXHRcdHRoaXMuX2FsbG93V3JpdGUgPSB7fTtcblxuXHRcdHRoaXMuYWxsb3dSZWFkKCdub25lJyk7XG5cdFx0dGhpcy5hbGxvd0VtaXQoJ2FsbCcpO1xuXHRcdHRoaXMuYWxsb3dXcml0ZSgnbm9uZScpO1xuXHR9XG5cblx0Z2V0IG5hbWUoKSB7XG5cdFx0cmV0dXJuIHRoaXMuX25hbWU7XG5cdH1cblxuXHRzZXQgbmFtZShuYW1lKSB7XG5cdFx0Y2hlY2sobmFtZSwgU3RyaW5nKTtcblx0XHR0aGlzLl9uYW1lID0gbmFtZTtcblx0fVxuXG5cdGdldCBzdWJzY3JpcHRpb25OYW1lKCkge1xuXHRcdHJldHVybiBgc3RyZWFtLSR7dGhpcy5uYW1lfWA7XG5cdH1cblxuXHRnZXQgcmV0cmFuc21pdCgpIHtcblx0XHRyZXR1cm4gdGhpcy5fcmV0cmFuc21pdDtcblx0fVxuXG5cdHNldCByZXRyYW5zbWl0KHJldHJhbnNtaXQpIHtcblx0XHRjaGVjayhyZXRyYW5zbWl0LCBCb29sZWFuKTtcblx0XHR0aGlzLl9yZXRyYW5zbWl0ID0gcmV0cmFuc21pdDtcblx0fVxuXG5cdGdldCByZXRyYW5zbWl0VG9TZWxmKCkge1xuXHRcdHJldHVybiB0aGlzLl9yZXRyYW5zbWl0VG9TZWxmO1xuXHR9XG5cblx0c2V0IHJldHJhbnNtaXRUb1NlbGYocmV0cmFuc21pdFRvU2VsZikge1xuXHRcdGNoZWNrKHJldHJhbnNtaXRUb1NlbGYsIEJvb2xlYW4pO1xuXHRcdHRoaXMuX3JldHJhbnNtaXRUb1NlbGYgPSByZXRyYW5zbWl0VG9TZWxmO1xuXHR9XG5cblx0YWxsb3dSZWFkKGV2ZW50TmFtZSwgZm4pIHtcblx0XHRpZiAoZm4gPT09IHVuZGVmaW5lZCkge1xuXHRcdFx0Zm4gPSBldmVudE5hbWU7XG5cdFx0XHRldmVudE5hbWUgPSAnX19hbGxfXyc7XG5cdFx0fVxuXG5cdFx0aWYgKHR5cGVvZiBmbiA9PT0gJ2Z1bmN0aW9uJykge1xuXHRcdFx0cmV0dXJuIHRoaXMuX2FsbG93UmVhZFtldmVudE5hbWVdID0gZm47XG5cdFx0fVxuXG5cdFx0aWYgKHR5cGVvZiBmbiA9PT0gJ3N0cmluZycgJiYgWydhbGwnLCAnbm9uZScsICdsb2dnZWQnXS5pbmRleE9mKGZuKSA9PT0gLTEpIHtcblx0XHRcdGNvbnNvbGUuZXJyb3IoYGFsbG93UmVhZCBzaG9ydGN1dCAnJHtmbn0nIGlzIGludmFsaWRgKTtcblx0XHR9XG5cblx0XHRpZiAoZm4gPT09ICdhbGwnIHx8IGZuID09PSB0cnVlKSB7XG5cdFx0XHRyZXR1cm4gdGhpcy5fYWxsb3dSZWFkW2V2ZW50TmFtZV0gPSBmdW5jdGlvbigpIHtcblx0XHRcdFx0cmV0dXJuIHRydWU7XG5cdFx0XHR9O1xuXHRcdH1cblxuXHRcdGlmIChmbiA9PT0gJ25vbmUnIHx8IGZuID09PSBmYWxzZSkge1xuXHRcdFx0cmV0dXJuIHRoaXMuX2FsbG93UmVhZFtldmVudE5hbWVdID0gZnVuY3Rpb24oKSB7XG5cdFx0XHRcdHJldHVybiBmYWxzZTtcblx0XHRcdH07XG5cdFx0fVxuXG5cdFx0aWYgKGZuID09PSAnbG9nZ2VkJykge1xuXHRcdFx0cmV0dXJuIHRoaXMuX2FsbG93UmVhZFtldmVudE5hbWVdID0gZnVuY3Rpb24oKSB7XG5cdFx0XHRcdHJldHVybiBCb29sZWFuKHRoaXMudXNlcklkKTtcblx0XHRcdH07XG5cdFx0fVxuXHR9XG5cblx0YWxsb3dFbWl0KGV2ZW50TmFtZSwgZm4pIHtcblx0XHRpZiAoZm4gPT09IHVuZGVmaW5lZCkge1xuXHRcdFx0Zm4gPSBldmVudE5hbWU7XG5cdFx0XHRldmVudE5hbWUgPSAnX19hbGxfXyc7XG5cdFx0fVxuXG5cdFx0aWYgKHR5cGVvZiBmbiA9PT0gJ2Z1bmN0aW9uJykge1xuXHRcdFx0cmV0dXJuIHRoaXMuX2FsbG93RW1pdFtldmVudE5hbWVdID0gZm47XG5cdFx0fVxuXG5cdFx0aWYgKHR5cGVvZiBmbiA9PT0gJ3N0cmluZycgJiYgWydhbGwnLCAnbm9uZScsICdsb2dnZWQnXS5pbmRleE9mKGZuKSA9PT0gLTEpIHtcblx0XHRcdGNvbnNvbGUuZXJyb3IoYGFsbG93UmVhZCBzaG9ydGN1dCAnJHtmbn0nIGlzIGludmFsaWRgKTtcblx0XHR9XG5cblx0XHRpZiAoZm4gPT09ICdhbGwnIHx8IGZuID09PSB0cnVlKSB7XG5cdFx0XHRyZXR1cm4gdGhpcy5fYWxsb3dFbWl0W2V2ZW50TmFtZV0gPSBmdW5jdGlvbigpIHtcblx0XHRcdFx0cmV0dXJuIHRydWU7XG5cdFx0XHR9O1xuXHRcdH1cblxuXHRcdGlmIChmbiA9PT0gJ25vbmUnIHx8IGZuID09PSBmYWxzZSkge1xuXHRcdFx0cmV0dXJuIHRoaXMuX2FsbG93RW1pdFtldmVudE5hbWVdID0gZnVuY3Rpb24oKSB7XG5cdFx0XHRcdHJldHVybiBmYWxzZTtcblx0XHRcdH07XG5cdFx0fVxuXG5cdFx0aWYgKGZuID09PSAnbG9nZ2VkJykge1xuXHRcdFx0cmV0dXJuIHRoaXMuX2FsbG93RW1pdFtldmVudE5hbWVdID0gZnVuY3Rpb24oKSB7XG5cdFx0XHRcdHJldHVybiBCb29sZWFuKHRoaXMudXNlcklkKTtcblx0XHRcdH07XG5cdFx0fVxuXHR9XG5cblx0YWxsb3dXcml0ZShldmVudE5hbWUsIGZuKSB7XG5cdFx0aWYgKGZuID09PSB1bmRlZmluZWQpIHtcblx0XHRcdGZuID0gZXZlbnROYW1lO1xuXHRcdFx0ZXZlbnROYW1lID0gJ19fYWxsX18nO1xuXHRcdH1cblxuXHRcdGlmICh0eXBlb2YgZm4gPT09ICdmdW5jdGlvbicpIHtcblx0XHRcdHJldHVybiB0aGlzLl9hbGxvd1dyaXRlW2V2ZW50TmFtZV0gPSBmbjtcblx0XHR9XG5cblx0XHRpZiAodHlwZW9mIGZuID09PSAnc3RyaW5nJyAmJiBbJ2FsbCcsICdub25lJywgJ2xvZ2dlZCddLmluZGV4T2YoZm4pID09PSAtMSkge1xuXHRcdFx0Y29uc29sZS5lcnJvcihgYWxsb3dXcml0ZSBzaG9ydGN1dCAnJHtmbn0nIGlzIGludmFsaWRgKTtcblx0XHR9XG5cblx0XHRpZiAoZm4gPT09ICdhbGwnIHx8IGZuID09PSB0cnVlKSB7XG5cdFx0XHRyZXR1cm4gdGhpcy5fYWxsb3dXcml0ZVtldmVudE5hbWVdID0gZnVuY3Rpb24oKSB7XG5cdFx0XHRcdHJldHVybiB0cnVlO1xuXHRcdFx0fTtcblx0XHR9XG5cblx0XHRpZiAoZm4gPT09ICdub25lJyB8fCBmbiA9PT0gZmFsc2UpIHtcblx0XHRcdHJldHVybiB0aGlzLl9hbGxvd1dyaXRlW2V2ZW50TmFtZV0gPSBmdW5jdGlvbigpIHtcblx0XHRcdFx0cmV0dXJuIGZhbHNlO1xuXHRcdFx0fTtcblx0XHR9XG5cblx0XHRpZiAoZm4gPT09ICdsb2dnZWQnKSB7XG5cdFx0XHRyZXR1cm4gdGhpcy5fYWxsb3dXcml0ZVtldmVudE5hbWVdID0gZnVuY3Rpb24oKSB7XG5cdFx0XHRcdHJldHVybiBCb29sZWFuKHRoaXMudXNlcklkKTtcblx0XHRcdH07XG5cdFx0fVxuXHR9XG5cblx0aXNSZWFkQWxsb3dlZChzY29wZSwgZXZlbnROYW1lLCBhcmdzKSB7XG5cdFx0aWYgKHRoaXMuX2FsbG93UmVhZFtldmVudE5hbWVdKSB7XG5cdFx0XHRyZXR1cm4gdGhpcy5fYWxsb3dSZWFkW2V2ZW50TmFtZV0uY2FsbChzY29wZSwgZXZlbnROYW1lLCAuLi5hcmdzKTtcblx0XHR9XG5cblx0XHRyZXR1cm4gdGhpcy5fYWxsb3dSZWFkWydfX2FsbF9fJ10uY2FsbChzY29wZSwgZXZlbnROYW1lLCAuLi5hcmdzKTtcblx0fVxuXG5cdGlzRW1pdEFsbG93ZWQoc2NvcGUsIGV2ZW50TmFtZSwgLi4uYXJncykge1xuXHRcdGlmICh0aGlzLl9hbGxvd0VtaXRbZXZlbnROYW1lXSkge1xuXHRcdFx0cmV0dXJuIHRoaXMuX2FsbG93RW1pdFtldmVudE5hbWVdLmNhbGwoc2NvcGUsIGV2ZW50TmFtZSwgLi4uYXJncyk7XG5cdFx0fVxuXG5cdFx0cmV0dXJuIHRoaXMuX2FsbG93RW1pdFsnX19hbGxfXyddLmNhbGwoc2NvcGUsIGV2ZW50TmFtZSwgLi4uYXJncyk7XG5cdH1cblxuXHRpc1dyaXRlQWxsb3dlZChzY29wZSwgZXZlbnROYW1lLCBhcmdzKSB7XG5cdFx0aWYgKHRoaXMuX2FsbG93V3JpdGVbZXZlbnROYW1lXSkge1xuXHRcdFx0cmV0dXJuIHRoaXMuX2FsbG93V3JpdGVbZXZlbnROYW1lXS5jYWxsKHNjb3BlLCBldmVudE5hbWUsIC4uLmFyZ3MpO1xuXHRcdH1cblxuXHRcdHJldHVybiB0aGlzLl9hbGxvd1dyaXRlWydfX2FsbF9fJ10uY2FsbChzY29wZSwgZXZlbnROYW1lLCAuLi5hcmdzKTtcblx0fVxuXG5cdGFkZFN1YnNjcmlwdGlvbihzdWJzY3JpcHRpb24sIGV2ZW50TmFtZSkge1xuXHRcdHRoaXMuc3Vic2NyaXB0aW9ucy5wdXNoKHN1YnNjcmlwdGlvbik7XG5cblx0XHRpZiAoIXRoaXMuc3Vic2NyaXB0aW9uc0J5RXZlbnROYW1lW2V2ZW50TmFtZV0pIHtcblx0XHRcdHRoaXMuc3Vic2NyaXB0aW9uc0J5RXZlbnROYW1lW2V2ZW50TmFtZV0gPSBbXTtcblx0XHR9XG5cblx0XHR0aGlzLnN1YnNjcmlwdGlvbnNCeUV2ZW50TmFtZVtldmVudE5hbWVdLnB1c2goc3Vic2NyaXB0aW9uKTtcblx0fVxuXG5cdHJlbW92ZVN1YnNjcmlwdGlvbihzdWJzY3JpcHRpb24sIGV2ZW50TmFtZSkge1xuXHRcdGNvbnN0IGluZGV4ID0gdGhpcy5zdWJzY3JpcHRpb25zLmluZGV4T2Yoc3Vic2NyaXB0aW9uKTtcblx0XHRpZiAoaW5kZXggPiAtMSkge1xuXHRcdFx0dGhpcy5zdWJzY3JpcHRpb25zLnNwbGljZShpbmRleCwgMSk7XG5cdFx0fVxuXG5cdFx0aWYgKHRoaXMuc3Vic2NyaXB0aW9uc0J5RXZlbnROYW1lW2V2ZW50TmFtZV0pIHtcblx0XHRcdGNvbnN0IGluZGV4ID0gdGhpcy5zdWJzY3JpcHRpb25zQnlFdmVudE5hbWVbZXZlbnROYW1lXS5pbmRleE9mKHN1YnNjcmlwdGlvbik7XG5cdFx0XHRpZiAoaW5kZXggPiAtMSkge1xuXHRcdFx0XHR0aGlzLnN1YnNjcmlwdGlvbnNCeUV2ZW50TmFtZVtldmVudE5hbWVdLnNwbGljZShpbmRleCwgMSk7XG5cdFx0XHR9XG5cdFx0fVxuXHR9XG5cblx0dHJhbnNmb3JtKGV2ZW50TmFtZSwgZm4pIHtcblx0XHRpZiAodHlwZW9mIGV2ZW50TmFtZSA9PT0gJ2Z1bmN0aW9uJykge1xuXHRcdFx0Zm4gPSBldmVudE5hbWU7XG5cdFx0XHRldmVudE5hbWUgPSAnX19hbGxfXyc7XG5cdFx0fVxuXG5cdFx0aWYgKCF0aGlzLnRyYW5zZm9ybWVyc1tldmVudE5hbWVdKSB7XG5cdFx0XHR0aGlzLnRyYW5zZm9ybWVyc1tldmVudE5hbWVdID0gW107XG5cdFx0fVxuXG5cdFx0dGhpcy50cmFuc2Zvcm1lcnNbZXZlbnROYW1lXS5wdXNoKGZuKTtcblx0fVxuXG5cdGFwcGx5VHJhbnNmb3JtZXJzKG1ldGhvZFNjb3BlLCBldmVudE5hbWUsIGFyZ3MpIHtcblx0XHRpZiAodGhpcy50cmFuc2Zvcm1lcnNbJ19fYWxsX18nXSkge1xuXHRcdFx0dGhpcy50cmFuc2Zvcm1lcnNbJ19fYWxsX18nXS5mb3JFYWNoKCh0cmFuc2Zvcm0pID0+IHtcblx0XHRcdFx0YXJncyA9IHRyYW5zZm9ybS5jYWxsKG1ldGhvZFNjb3BlLCBldmVudE5hbWUsIGFyZ3MpO1xuXHRcdFx0XHRtZXRob2RTY29wZS50cmFuZm9ybWVkID0gdHJ1ZTtcblx0XHRcdFx0aWYgKCFBcnJheS5pc0FycmF5KGFyZ3MpKSB7XG5cdFx0XHRcdFx0YXJncyA9IFthcmdzXTtcblx0XHRcdFx0fVxuXHRcdFx0fSk7XG5cdFx0fVxuXG5cdFx0aWYgKHRoaXMudHJhbnNmb3JtZXJzW2V2ZW50TmFtZV0pIHtcblx0XHRcdHRoaXMudHJhbnNmb3JtZXJzW2V2ZW50TmFtZV0uZm9yRWFjaCgodHJhbnNmb3JtKSA9PiB7XG5cdFx0XHRcdGFyZ3MgPSB0cmFuc2Zvcm0uY2FsbChtZXRob2RTY29wZSwgLi4uYXJncyk7XG5cdFx0XHRcdG1ldGhvZFNjb3BlLnRyYW5mb3JtZWQgPSB0cnVlO1xuXHRcdFx0XHRpZiAoIUFycmF5LmlzQXJyYXkoYXJncykpIHtcblx0XHRcdFx0XHRhcmdzID0gW2FyZ3NdO1xuXHRcdFx0XHR9XG5cdFx0XHR9KTtcblx0XHR9XG5cblx0XHRyZXR1cm4gYXJncztcblx0fVxuXG5cblx0X3B1Ymxpc2gocHVibGljYXRpb24sIGV2ZW50TmFtZSwgb3B0aW9ucykge1xuXHRcdGNoZWNrKGV2ZW50TmFtZSwgU3RyaW5nKTtcblx0XHRjaGVjayhvcHRpb25zLCBNYXRjaC5PbmVPZihCb29sZWFuLCB7XG5cdFx0XHR1c2VDb2xsZWN0aW9uOiBCb29sZWFuLFxuXHRcdFx0YXJnczogQXJyYXksXG5cdFx0fSkpO1xuXG5cdFx0bGV0IHVzZUNvbGxlY3Rpb24sIGFyZ3MgPSBbXTtcblxuXHRcdGlmICh0eXBlb2Ygb3B0aW9ucyA9PT0gJ2Jvb2xlYW4nKSB7XG5cdFx0XHR1c2VDb2xsZWN0aW9uID0gb3B0aW9ucztcblx0XHR9IGVsc2Uge1xuXHRcdFx0aWYgKG9wdGlvbnMudXNlQ29sbGVjdGlvbikge1xuXHRcdFx0XHR1c2VDb2xsZWN0aW9uID0gb3B0aW9ucy51c2VDb2xsZWN0aW9uO1xuXHRcdFx0fVxuXG5cdFx0XHRpZiAob3B0aW9ucy5hcmdzKSB7XG5cdFx0XHRcdGFyZ3MgPSBvcHRpb25zLmFyZ3M7XG5cdFx0XHR9XG5cdFx0fVxuXG5cdFx0aWYgKGV2ZW50TmFtZS5sZW5ndGggPT09IDApIHtcblx0XHRcdHB1YmxpY2F0aW9uLnN0b3AoKTtcblx0XHRcdHRocm93IG5ldyBNZXRlb3IuRXJyb3IoJ2ludmFsaWQtZXZlbnQtbmFtZScpO1xuXHRcdH1cblxuXHRcdGlmICh0aGlzLmlzUmVhZEFsbG93ZWQocHVibGljYXRpb24sIGV2ZW50TmFtZSwgYXJncykgIT09IHRydWUpIHtcblx0XHRcdHB1YmxpY2F0aW9uLnN0b3AoKTtcblx0XHRcdHRocm93IG5ldyBNZXRlb3IuRXJyb3IoJ25vdC1hbGxvd2VkJyk7XG5cdFx0fVxuXG5cdFx0Y29uc3Qgc3Vic2NyaXB0aW9uID0ge1xuXHRcdFx0c3Vic2NyaXB0aW9uOiBwdWJsaWNhdGlvbixcblx0XHRcdGV2ZW50TmFtZTogZXZlbnROYW1lXG5cdFx0fTtcblxuXHRcdHRoaXMuYWRkU3Vic2NyaXB0aW9uKHN1YnNjcmlwdGlvbiwgZXZlbnROYW1lKTtcblxuXHRcdHB1YmxpY2F0aW9uLm9uU3RvcCgoKSA9PiB7XG5cdFx0XHR0aGlzLnJlbW92ZVN1YnNjcmlwdGlvbihzdWJzY3JpcHRpb24sIGV2ZW50TmFtZSk7XG5cdFx0fSk7XG5cblx0XHRpZiAodXNlQ29sbGVjdGlvbiA9PT0gdHJ1ZSkge1xuXHRcdFx0Ly8gQ29sbGVjdGlvbiBjb21wYXRpYmlsaXR5XG5cdFx0XHRwdWJsaWNhdGlvbi5fc2Vzc2lvbi5zZW5kQWRkZWQodGhpcy5zdWJzY3JpcHRpb25OYW1lLCAnaWQnLCB7XG5cdFx0XHRcdGV2ZW50TmFtZTogZXZlbnROYW1lXG5cdFx0XHR9KTtcblx0XHR9XG5cblx0XHRwdWJsaWNhdGlvbi5yZWFkeSgpO1xuXHR9XG5cblx0aW5pUHVibGljYXRpb24oKSB7XG5cdFx0Y29uc3Qgc3RyZWFtID0gdGhpcztcblx0XHRNZXRlb3IucHVibGlzaCh0aGlzLnN1YnNjcmlwdGlvbk5hbWUsIGZ1bmN0aW9uICguLi5hcmdzKSB7IHJldHVybiBzdHJlYW0uX3B1Ymxpc2guYXBwbHkoc3RyZWFtLCBbdGhpcywgLi4uYXJnc10pOyB9KTtcblx0fVxuXG5cdGluaXRNZXRob2QoKSB7XG5cdFx0Y29uc3Qgc3RyZWFtID0gdGhpcztcblx0XHRjb25zdCBtZXRob2QgPSB7fTtcblxuXHRcdG1ldGhvZFt0aGlzLnN1YnNjcmlwdGlvbk5hbWVdID0gZnVuY3Rpb24oZXZlbnROYW1lLCAuLi5hcmdzKSB7XG5cdFx0XHRjaGVjayhldmVudE5hbWUsIFN0cmluZyk7XG5cdFx0XHRjaGVjayhhcmdzLCBBcnJheSk7XG5cblx0XHRcdHRoaXMudW5ibG9jaygpO1xuXG5cdFx0XHRpZiAoc3RyZWFtLmlzV3JpdGVBbGxvd2VkKHRoaXMsIGV2ZW50TmFtZSwgYXJncykgIT09IHRydWUpIHtcblx0XHRcdFx0cmV0dXJuO1xuXHRcdFx0fVxuXG5cdFx0XHRjb25zdCBtZXRob2RTY29wZSA9IHtcblx0XHRcdFx0dXNlcklkOiB0aGlzLnVzZXJJZCxcblx0XHRcdFx0Y29ubmVjdGlvbjogdGhpcy5jb25uZWN0aW9uLFxuXHRcdFx0XHRvcmlnaW5hbFBhcmFtczogYXJncyxcblx0XHRcdFx0dHJhbmZvcm1lZDogZmFsc2Vcblx0XHRcdH07XG5cblx0XHRcdGFyZ3MgPSBzdHJlYW0uYXBwbHlUcmFuc2Zvcm1lcnMobWV0aG9kU2NvcGUsIGV2ZW50TmFtZSwgYXJncyk7XG5cblx0XHRcdHN0cmVhbS5lbWl0V2l0aFNjb3BlKGV2ZW50TmFtZSwgbWV0aG9kU2NvcGUsIC4uLmFyZ3MpO1xuXG5cdFx0XHRpZiAoc3RyZWFtLnJldHJhbnNtaXQgPT09IHRydWUpIHtcblx0XHRcdFx0c3RyZWFtLl9lbWl0KGV2ZW50TmFtZSwgYXJncywgdGhpcy5jb25uZWN0aW9uLCB0cnVlKTtcblx0XHRcdH1cblx0XHR9O1xuXG5cdFx0dHJ5IHtcblx0XHRcdE1ldGVvci5tZXRob2RzKG1ldGhvZCk7XG5cdFx0fSBjYXRjaCAoZSkge1xuXHRcdFx0Y29uc29sZS5lcnJvcihlKTtcblx0XHR9XG5cdH1cblxuXHRfZW1pdChldmVudE5hbWUsIGFyZ3MsIG9yaWdpbiwgYnJvYWRjYXN0KSB7XG5cdFx0aWYgKGJyb2FkY2FzdCA9PT0gdHJ1ZSkge1xuXHRcdFx0TWV0ZW9yLlN0cmVhbWVyQ2VudHJhbC5lbWl0KCdicm9hZGNhc3QnLCB0aGlzLm5hbWUsIGV2ZW50TmFtZSwgYXJncyk7XG5cdFx0fVxuXG5cdFx0Y29uc3Qgc3Vic2NyaXB0aW9ucyA9IHRoaXMuc3Vic2NyaXB0aW9uc0J5RXZlbnROYW1lW2V2ZW50TmFtZV07XG5cdFx0aWYgKCFBcnJheS5pc0FycmF5KHN1YnNjcmlwdGlvbnMpKSB7XG5cdFx0XHRyZXR1cm47XG5cdFx0fVxuXG5cdFx0Y29uc3QgbXNnID0gY2hhbmdlZFBheWxvYWQodGhpcy5zdWJzY3JpcHRpb25OYW1lLCAnaWQnLCB7XG5cdFx0XHRldmVudE5hbWUsXG5cdFx0XHRhcmdzXG5cdFx0fSk7XG5cblx0XHRpZighbXNnKSB7XG5cdFx0XHRyZXR1cm47XG5cdFx0fVxuXG5cdFx0c3Vic2NyaXB0aW9ucy5mb3JFYWNoKChzdWJzY3JpcHRpb24pID0+IHtcblx0XHRcdGlmICh0aGlzLnJldHJhbnNtaXRUb1NlbGYgPT09IGZhbHNlICYmIG9yaWdpbiAmJiBvcmlnaW4gPT09IHN1YnNjcmlwdGlvbi5zdWJzY3JpcHRpb24uY29ubmVjdGlvbikge1xuXHRcdFx0XHRyZXR1cm47XG5cdFx0XHR9XG5cblx0XHRcdGlmICh0aGlzLmlzRW1pdEFsbG93ZWQoc3Vic2NyaXB0aW9uLnN1YnNjcmlwdGlvbiwgZXZlbnROYW1lLCAuLi5hcmdzKSkge1xuXHRcdFx0XHRzZW5kKHN1YnNjcmlwdGlvbi5zdWJzY3JpcHRpb24uX3Nlc3Npb24sIG1zZyk7XG5cdFx0XHR9XG5cdFx0fSk7XG5cdH1cblxuXHRlbWl0KGV2ZW50TmFtZSwgLi4uYXJncykge1xuXHRcdHRoaXMuX2VtaXQoZXZlbnROYW1lLCBhcmdzLCB1bmRlZmluZWQsIHRydWUpO1xuXHR9XG5cblx0X19lbWl0KC4uLmFyZ3MpIHtcblx0XHRyZXR1cm4gc3VwZXIuZW1pdCguLi5hcmdzKTtcblx0fVxuXG5cdGVtaXRXaXRob3V0QnJvYWRjYXN0KGV2ZW50TmFtZSwgLi4uYXJncykge1xuXHRcdHRoaXMuX2VtaXQoZXZlbnROYW1lLCBhcmdzLCB1bmRlZmluZWQsIGZhbHNlKTtcblx0fVxufTtcbiJdfQ==
