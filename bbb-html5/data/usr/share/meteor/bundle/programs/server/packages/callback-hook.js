(function () {

/* Imports */
var Meteor = Package.meteor.Meteor;
var global = Package.meteor.global;
var meteorEnv = Package.meteor.meteorEnv;
var ECMAScript = Package.ecmascript.ECMAScript;
var meteorInstall = Package.modules.meteorInstall;
var Promise = Package.promise.Promise;

/* Package-scope variables */
var options, callback, Hook;

var require = meteorInstall({"node_modules":{"meteor":{"callback-hook":{"hook.js":function module(require,exports,module){

/////////////////////////////////////////////////////////////////////////////////////////////////////
//                                                                                                 //
// packages/callback-hook/hook.js                                                                  //
//                                                                                                 //
/////////////////////////////////////////////////////////////////////////////////////////////////////
                                                                                                   //
module.export({
  Hook: () => Hook
});
// XXX This pattern is under development. Do not add more callsites
// using this package for now. See:
// https://meteor.hackpad.com/Design-proposal-Hooks-YxvgEW06q6f
//
// Encapsulates the pattern of registering callbacks on a hook.
//
// The `each` method of the hook calls its iterator function argument
// with each registered callback.  This allows the hook to
// conditionally decide not to call the callback (if, for example, the
// observed object has been closed or terminated).
//
// By default, callbacks are bound with `Meteor.bindEnvironment`, so they will be
// called with the Meteor environment of the calling code that
// registered the callback. Override by passing { bindEnvironment: false }
// to the constructor.
//
// Registering a callback returns an object with a single `stop`
// method which unregisters the callback.
//
// The code is careful to allow a callback to be safely unregistered
// while the callbacks are being iterated over.
//
// If the hook is configured with the `exceptionHandler` option, the
// handler will be called if a called callback throws an exception.
// By default (if the exception handler doesn't itself throw an
// exception, or if the iterator function doesn't return a falsy value
// to terminate the calling of callbacks), the remaining callbacks
// will still be called.
//
// Alternatively, the `debugPrintExceptions` option can be specified
// as string describing the callback.  On an exception the string and
// the exception will be printed to the console log with
// `Meteor._debug`, and the exception otherwise ignored.
//
// If an exception handler isn't specified, exceptions thrown in the
// callback will propagate up to the iterator function, and will
// terminate calling the remaining callbacks if not caught.
const hasOwn = Object.prototype.hasOwnProperty;

class Hook {
  constructor(options) {
    options = options || {};
    this.nextCallbackId = 0;
    this.callbacks = Object.create(null); // Whether to wrap callbacks with Meteor.bindEnvironment

    this.bindEnvironment = true;

    if (options.bindEnvironment === false) {
      this.bindEnvironment = false;
    }

    if (options.exceptionHandler) {
      this.exceptionHandler = options.exceptionHandler;
    } else if (options.debugPrintExceptions) {
      if (typeof options.debugPrintExceptions !== "string") {
        throw new Error("Hook option debugPrintExceptions should be a string");
      }

      this.exceptionHandler = options.debugPrintExceptions;
    }
  }

  register(callback) {
    const exceptionHandler = this.exceptionHandler || function (exception) {
      // Note: this relies on the undocumented fact that if bindEnvironment's
      // onException throws, and you are invoking the callback either in the
      // browser or from within a Fiber in Node, the exception is propagated.
      throw exception;
    };

    if (this.bindEnvironment) {
      callback = Meteor.bindEnvironment(callback, exceptionHandler);
    } else {
      callback = dontBindEnvironment(callback, exceptionHandler);
    }

    const id = this.nextCallbackId++;
    this.callbacks[id] = callback;
    return {
      callback,
      stop: () => {
        delete this.callbacks[id];
      }
    };
  } // For each registered callback, call the passed iterator function
  // with the callback.
  //
  // The iterator function can choose whether or not to call the
  // callback.  (For example, it might not call the callback if the
  // observed object has been closed or terminated).
  //
  // The iteration is stopped if the iterator function returns a falsy
  // value or throws an exception.
  //


  each(iterator) {
    // Invoking bindEnvironment'd callbacks outside of a Fiber in Node doesn't
    // run them to completion (and exceptions thrown from onException are not
    // propagated), so we need to be in a Fiber.
    Meteor._nodeCodeMustBeInFiber();

    const ids = Object.keys(this.callbacks);

    for (let i = 0; i < ids.length; ++i) {
      const id = ids[i]; // check to see if the callback was removed during iteration

      if (hasOwn.call(this.callbacks, id)) {
        const callback = this.callbacks[id];

        if (!iterator(callback)) {
          break;
        }
      }
    }
  }

}

// Copied from Meteor.bindEnvironment and removed all the env stuff.
function dontBindEnvironment(func, onException, _this) {
  if (!onException || typeof onException === 'string') {
    const description = onException || "callback of async function";

    onException = function (error) {
      Meteor._debug("Exception in " + description, error);
    };
  }

  return function () {
    let ret;

    try {
      for (var _len = arguments.length, args = new Array(_len), _key = 0; _key < _len; _key++) {
        args[_key] = arguments[_key];
      }

      ret = func.apply(_this, args);
    } catch (e) {
      onException(e);
    }

    return ret;
  };
}
/////////////////////////////////////////////////////////////////////////////////////////////////////

}}}}},{
  "extensions": [
    ".js",
    ".json"
  ]
});

var exports = require("/node_modules/meteor/callback-hook/hook.js");

/* Exports */
Package._define("callback-hook", exports, {
  Hook: Hook
});

})();

//# sourceURL=meteor://💻app/packages/callback-hook.js
//# sourceMappingURL=data:application/json;charset=utf8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIm1ldGVvcjovL/CfkrthcHAvcGFja2FnZXMvY2FsbGJhY2staG9vay9ob29rLmpzIl0sIm5hbWVzIjpbIm1vZHVsZSIsImV4cG9ydCIsIkhvb2siLCJoYXNPd24iLCJPYmplY3QiLCJwcm90b3R5cGUiLCJoYXNPd25Qcm9wZXJ0eSIsImNvbnN0cnVjdG9yIiwib3B0aW9ucyIsIm5leHRDYWxsYmFja0lkIiwiY2FsbGJhY2tzIiwiY3JlYXRlIiwiYmluZEVudmlyb25tZW50IiwiZXhjZXB0aW9uSGFuZGxlciIsImRlYnVnUHJpbnRFeGNlcHRpb25zIiwiRXJyb3IiLCJyZWdpc3RlciIsImNhbGxiYWNrIiwiZXhjZXB0aW9uIiwiTWV0ZW9yIiwiZG9udEJpbmRFbnZpcm9ubWVudCIsImlkIiwic3RvcCIsImVhY2giLCJpdGVyYXRvciIsIl9ub2RlQ29kZU11c3RCZUluRmliZXIiLCJpZHMiLCJrZXlzIiwiaSIsImxlbmd0aCIsImNhbGwiLCJmdW5jIiwib25FeGNlcHRpb24iLCJfdGhpcyIsImRlc2NyaXB0aW9uIiwiZXJyb3IiLCJfZGVidWciLCJyZXQiLCJhcmdzIiwiYXBwbHkiLCJlIl0sIm1hcHBpbmdzIjoiOzs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7QUFBQUEsTUFBTSxDQUFDQyxNQUFQLENBQWM7QUFBQ0MsTUFBSSxFQUFDLE1BQUlBO0FBQVYsQ0FBZDtBQUFBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBRUEsTUFBTUMsTUFBTSxHQUFHQyxNQUFNLENBQUNDLFNBQVAsQ0FBaUJDLGNBQWhDOztBQUVPLE1BQU1KLElBQU4sQ0FBVztBQUNoQkssYUFBVyxDQUFDQyxPQUFELEVB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TyxZQUFtQjtBQUN4QixRQUFJRSxHQUFKOztBQUNBLFFBQUk7QUFBQSx3Q0FGY0MsSUFFZDtBQUZjQSxZQUVkO0FBQUE7O0FBQ0ZELFNBQUcsR0FBR04sSUFBSSxDQUFDUSxLQUFMLENBQVdOLEtBQVgsRUFBa0JLLElBQWxCLENBQU47QUFDRCxLQUZELENBRUUsT0FBT0UsQ0FBUCxFQUFVO0FBQ1ZSLGlCQUFXLENBQUNRLENBQUQsQ0FBWDtBQUNEOztBQUNELFdBQU9ILEdBQVA7QUFDRCxHQVJEO0FBU0QsQyIsImZpbGUiOiIvcGFja2FnZXMvY2FsbGJhY2staG9vay5qcyIsInNvdXJjZXNDb250ZW50IjpbIi8vIFhYWCBUaGlzIHBhdHRlcm4gaXMgdW5kZXIgZGV2ZWxvcG1lbnQuIERvIG5vdCBhZGQgbW9yZSBjYWxsc2l0ZXNcbi8vIHVzaW5nIHRoaXMgcGFja2FnZSBmb3Igbm93LiBTZWU6XG4vLyBodHRwczovL21ldGVvci5oYWNrcGFkLmNvbS9EZXNpZ24tcHJvcG9zYWwtSG9va3MtWXh2Z0VXMDZxNmZcbi8vXG4vLyBFbmNhcHN1bGF0ZXMgdGhlIHBhdHRlcm4gb2YgcmVnaXN0ZXJpbmcgY2FsbGJhY2tzIG9uIGEgaG9vay5cbi8vXG4vLyBUaGUgYGVhY2hgIG1ldGhvZCBvZiB0aGUgaG9vayBjYWxscyBpdHMgaXRlcmF0b3IgZnVuY3Rpb24gYXJndW1lbnRcbi8vIHdpdGggZWFjaCByZWdpc3RlcmVkIGNhbGxiYWNrLiAgVGhpcyBhbGxvd3MgdGhlIGhvb2sgdG9cbi8vIGNvbmRpdGlvbmFsbHkgZGVjaWRlIG5vdCB0byBjYWxsIHRoZSBjYWxsYmFjayAoaWYsIGZvciBleGFtcGxlLCB0aGVcbi8vIG9ic2VydmVkIG9iamVjdCBoYXMgYmVlbiBjbG9zZWQgb3IgdGVybWluYXRlZCkuXG4vL1xuLy8gQnkgZGVmYXVsdCwgY2FsbGJhY2tzIGFyZSBib3VuZCB3aXRoIGBNZXRlb3IuYmluZEVudmlyb25tZW50YCwgc28gdGhleSB3aWxsIGJlXG4vLyBjYWxsZWQgd2l0aCB0aGUgTWV0ZW9yIGVudmlyb25tZW50IG9mIHRoZSBjYWxsaW5nIGNvZGUgdGhhdFxuLy8gcmVnaXN0ZXJlZCB0aGUgY2FsbGJhY2suIE92ZXJyaWRlIGJ5IHBhc3NpbmcgeyBiaW5kRW52aXJvbm1lbnQ6IGZhbHNlIH1cbi8vIHRvIHRoZSBjb25zdHJ1Y3Rvci5cbi8vXG4vLyBSZWdpc3RlcmluZyBhIGNhbGxiYWNrIHJldHVybnMgYW4gb2JqZWN0IHdpdGggYSBzaW5nbGUgYHN0b3BgXG4vLyBtZXRob2Qgd2hpY2ggdW5yZWdpc3RlcnMgdGhlIGNhbGxiYWNrLlxuLy9cbi8vIFRoZSBjb2RlIGlzIGNhcmVmdWwgdG8gYWxsb3cgYSBjYWxsYmFjayB0byBiZSBzYWZlbHkgdW5yZWdpc3RlcmVkXG4vLyB3aGlsZSB0aGUgY2FsbGJhY2tzIGFyZSBiZWluZyBpdGVyYXRlZCBvdmVyLlxuLy9cbi8vIElmIHRoZSBob29rIGlzIGNvbmZpZ3VyZWQgd2l0aCB0aGUgYGV4Y2VwdGlvbkhhbmRsZXJgIG9wdGlvbiwgdGhlXG4vLyBoYW5kbGVyIHdpbGwgYmUgY2FsbGVkIGlmIGEgY2FsbGVkIGNhbGxiYWNrIHRocm93cyBhbiBleGNlcHRpb24uXG4vLyBCeSBkZWZhdWx0IChpZiB0aGUgZXhjZXB0aW9uIGhhbmRsZXIgZG9lc24ndCBpdHNlbGYgdGhyb3cgYW5cbi8vIGV4Y2VwdGlvbiwgb3IgaWYgdGhlIGl0ZXJhdG9yIGZ1bmN0aW9uIGRvZXNuJ3QgcmV0dXJuIGEgZmFsc3kgdmFsdWVcbi8vIHRvIHRlcm1pbmF0ZSB0aGUgY2FsbGluZyBvZiBjYWxsYmFja3MpLCB0aGUgcmVtYWluaW5nIGNhbGxiYWNrc1xuLy8gd2lsbCBzdGlsbCBiZSBjYWxsZWQuXG4vL1xuLy8gQWx0ZXJuYXRpdmVseSwgdGhlIGBkZWJ1Z1ByaW50RXhjZXB0aW9uc2Agb3B0aW9uIGNhbiBiZSBzcGVjaWZpZWRcbi8vIGFzIHN0cmluZyBkZXNjcmliaW5nIHRoZSBjYWxsYmFjay4gIE9uIGFuIGV4Y2VwdGlvbiB0aGUgc3RyaW5nIGFuZFxuLy8gdGhlIGV4Y2VwdGlvbiB3aWxsIGJlIHByaW50ZWQgdG8gdGhlIGNvbnNvbGUgbG9nIHdpdGhcbi8vIGBNZXRlb3IuX2RlYnVnYCwgYW5kIHRoZSBleGNlcHRpb24gb3RoZXJ3aXNlIGlnbm9yZWQuXG4vL1xuLy8gSWYgYW4gZXhjZXB0aW9uIGhhbmRsZXIgaXNuJ3Qgc3BlY2lmaWVkLCBleGNlcHRpb25zIHRocm93biBpbiB0aGVcbi8vIGNhbGxiYWNrIHdpbGwgcHJvcGFnYXRlIHVwIHRvIHRoZSBpdGVyYXRvciBmdW5jdGlvbiwgYW5kIHdpbGxcbi8vIHRlcm1pbmF0ZSBjYWxsaW5nIHRoZSByZW1haW5pbmcgY2FsbGJhY2tzIGlmIG5vdCBjYXVnaHQuXG5cbmNvbnN0IGhhc093biA9IE9iamVjdC5wcm90b3R5cGUuaGFzT3duUHJvcGVydHk7XG5cbmV4cG9ydCBjbGFzcyBIb29rIHtcbiAgY29uc3RydWN0b3Iob3B0aW9ucykge1xuICAgIG9wdGlvbnMgPSBvcHRpb25zIHx8IHt9O1xuICAgIHRoaXMubmV4dENhbGxiYWNrSWQgPSAwO1xuICAgIHRoaXMuY2FsbGJhY2tzID0gT2JqZWN0LmNyZWF0ZShudWxsKTtcbiAgICAvLyBXaGV0aGVyIHRvIHdyYXAgY2FsbGJhY2tzIHdpdGggTWV0ZW9yLmJpbmRFbnZpcm9ubWVudFxuICAgIHRoaXMuYmluZEVudmlyb25tZW50ID0gdHJ1ZTtcbiAgICBpZiAob3B0aW9ucy5iaW5kRW52aXJvbm1lbnQgPT09IGZhbHNlKSB7XG4gICAgICB0aGlzLmJpbmRFbnZpcm9ubWVudCA9IGZhbHNlO1xuICAgIH1cblxuICAgIGlmIChvcHRpb25zLmV4Y2VwdGlvbkhhbmRsZXIpIHtcbiAgICAgIHRoaXMuZXhjZXB0aW9uSGFuZGxlciA9IG9wdGlvbnMuZXhjZXB0aW9uSGFuZGxlcjtcbiAgICB9IGVsc2UgaWYgKG9wdGlvbnMuZGVidWdQcmludEV4Y2VwdGlvbnMpIHtcbiAgICAgIGlmICh0eXBlb2Ygb3B0aW9ucy5kZWJ1Z1ByaW50RXhjZXB0aW9ucyAhPT0gXCJzdHJpbmdcIikge1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoXCJIb29rIG9wdGlvbiBkZWJ1Z1ByaW50RXhjZXB0aW9ucyBzaG91bGQgYmUgYSBzdHJpbmdcIik7XG4gICAgICB9XG4gICAgICB0aGlzLmV4Y2VwdGlvbkhhbmRsZXIgPSBvcHRpb25zLmRlYnVnUHJpbnRFeGNlcHRpb25zO1xuICAgIH1cbiAgfVxuXG4gIHJlZ2lzdGVyKGNhbGxiYWNrKSB7XG4gICAgY29uc3QgZXhjZXB0aW9uSGFuZGxlciA9IHRoaXMuZXhjZXB0aW9uSGFuZGxlciB8fCBmdW5jdGlvbiAoZXhjZXB0aW9uKSB7XG4gICAgICAvLyBOb3RlOiB0aGlzIHJlbGllcyBvbiB0aGUgdW5kb2N1bWVudGVkIGZhY3QgdGhhdCBpZiBiaW5kRW52aXJvbm1lbnQnc1xuICAgICAgLy8gb25FeGNlcHRpb24gdGhyb3dzLCBhbmQgeW91IGFyZSBpbnZva2luZyB0aGUgY2FsbGJhY2sgZWl0aGVyIGluIHRoZVxuICAgICAgLy8gYnJvd3NlciBvciBmcm9tIHdpdGhpbiBhIEZpYmVyIGluIE5vZGUsIHRoZSBleGNlcHRpb24gaXMgcHJvcGFnYXRlZC5cbiAgICAgIHRocm93IGV4Y2VwdGlvbjtcbiAgICB9O1xuXG4gICAgaWYgKHRoaXMuYmluZEVudmlyb25tZW50KSB7XG4gICAgICBjYWxsYmFjayA9IE1ldGVvci5iaW5kRW52aXJvbm1lbnQoY2FsbGJhY2ssIGV4Y2VwdGlvbkhhbmRsZXIpO1xuICAgIH0gZWxzZSB7XG4gICAgICBjYWxsYmFjayA9IGRvbnRCaW5kRW52aXJvbm1lbnQoY2FsbGJhY2ssIGV4Y2VwdGlvbkhhbmRsZXIpO1xuICAgIH1cblxuICAgIGNvbnN0IGlkID0gdGhpcy5uZXh0Q2FsbGJhY2tJZCsrO1xuICAgIHRoaXMuY2FsbGJhY2tzW2lkXSA9IGNhbGxiYWNrO1xuXG4gICAgcmV0dXJuIHtcbiAgICAgIGNhbGxiYWNrLFxuICAgICAgc3RvcDogKCkgPT4ge1xuICAgICAgICBkZWxldGUgdGhpcy5jYWxsYmFja3NbaWRdO1xuICAgICAgfVxuICAgIH07XG4gIH1cblxuICAvLyBGb3IgZWFjaCByZWdpc3RlcmVkIGNhbGxiYWNrLCBjYWxsIHRoZSBwYXNzZWQgaXRlcmF0b3IgZnVuY3Rpb25cbiAgLy8gd2l0aCB0aGUgY2FsbGJhY2suXG4gIC8vXG4gIC8vIFRoZSBpdGVyYXRvciBmdW5jdGlvbiBjYW4gY2hvb3NlIHdoZXRoZXIgb3Igbm90IHRvIGNhbGwgdGhlXG4gIC8vIGNhbGxiYWNrLiAgKEZvciBleGFtcGxlLCBpdCBtaWdodCBub3QgY2FsbCB0aGUgY2FsbGJhY2sgaWYgdGhlXG4gIC8vIG9ic2VydmVkIG9iamVjdCBoYXMgYmVlbiBjbG9zZWQgb3IgdGVybWluYXRlZCkuXG4gIC8vXG4gIC8vIFRoZSBpdGVyYXRpb24gaXMgc3RvcHBlZCBpZiB0aGUgaXRlcmF0b3IgZnVuY3Rpb24gcmV0dXJucyBhIGZhbHN5XG4gIC8vIHZhbHVlIG9yIHRocm93cyBhbiBleGNlcHRpb24uXG4gIC8vXG4gIGVhY2goaXRlcmF0b3IpIHtcbiAgICAvLyBJbnZva2luZyBiaW5kRW52aXJvbm1lbnQnZCBjYWxsYmFja3Mgb3V0c2lkZSBvZiBhIEZpYmVyIGluIE5vZGUgZG9lc24ndFxuICAgIC8vIHJ1biB0aGVtIHRvIGNvbXBsZXRpb24gKGFuZCBleGNlcHRpb25zIHRocm93biBmcm9tIG9uRXhjZXB0aW9uIGFyZSBub3RcbiAgICAvLyBwcm9wYWdhdGVkKSwgc28gd2UgbmVlZCB0byBiZSBpbiBhIEZpYmVyLlxuICAgIE1ldGVvci5fbm9kZUNvZGVNdXN0QmVJbkZpYmVyKCk7XG5cbiAgICBjb25zdCBpZHMgPSBPYmplY3Qua2V5cyh0aGlzLmNhbGxiYWNrcyk7XG4gICAgZm9yIChsZXQgaSA9IDA7ICBpIDwgaWRzLmxlbmd0aDsgICsraSkge1xuICAgICAgY29uc3QgaWQgPSBpZHNbaV07XG4gICAgICAvLyBjaGVjayB0byBzZWUgaWYgdGhlIGNhbGxiYWNrIHdhcyByZW1vdmVkIGR1cmluZyBpdGVyYXRpb25cbiAgICAgIGlmIChoYXNPd24uY2FsbCh0aGlzLmNhbGxiYWNrcywgaWQpKSB7XG4gICAgICAgIGNvbnN0IGNhbGxiYWNrID0gdGhpcy5jYWxsYmFja3NbaWRdO1xuICAgICAgICBpZiAoISBpdGVyYXRvcihjYWxsYmFjaykpIHtcbiAgICAgICAgICBicmVhaztcbiAgICAgICAgfVxuICAgICAgfVxuICAgIH1cbiAgfVxufVxuXG4vLyBDb3BpZWQgZnJvbSBNZXRlb3IuYmluZEVudmlyb25tZW50IGFuZCByZW1vdmVkIGFsbCB0aGUgZW52IHN0dWZmLlxuZnVuY3Rpb24gZG9udEJpbmRFbnZpcm9ubWVudChmdW5jLCBvbkV4Y2VwdGlvbiwgX3RoaXMpIHtcbiAgaWYgKCFvbkV4Y2VwdGlvbiB8fCB0eXBlb2Yob25FeGNlcHRpb24pID09PSAnc3RyaW5nJykge1xuICAgIGNvbnN0IGRlc2NyaXB0aW9uID0gb25FeGNlcHRpb24gfHwgXCJjYWxsYmFjayBvZiBhc3luYyBmdW5jdGlvblwiO1xuICAgIG9uRXhjZXB0aW9uID0gZnVuY3Rpb24gKGVycm9yKSB7XG4gICAgICBNZXRlb3IuX2RlYnVnKFxuICAgICAgICBcIkV4Y2VwdGlvbiBpbiBcIiArIGRlc2NyaXB0aW9uLFxuICAgICAgICBlcnJvclxuICAgICAgKTtcbiAgICB9O1xuICB9XG5cbiAgcmV0dXJuIGZ1bmN0aW9uICguLi5hcmdzKSB7XG4gICAgbGV0IHJldDtcbiAgICB0cnkge1xuICAgICAgcmV0ID0gZnVuYy5hcHBseShfdGhpcywgYXJncyk7XG4gICAgfSBjYXRjaCAoZSkge1xuICAgICAgb25FeGNlcHRpb24oZSk7XG4gICAgfVxuICAgIHJldHVybiByZXQ7XG4gIH07XG59XG4iXX0=
