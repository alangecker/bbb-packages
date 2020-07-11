(function () {

/* Imports */
var Meteor = Package.meteor.Meteor;
var global = Package.meteor.global;
var meteorEnv = Package.meteor.meteorEnv;
var Tracker = Package.tracker.Tracker;
var Deps = Package.tracker.Deps;
var ECMAScript = Package.ecmascript.ECMAScript;
var meteorInstall = Package.modules.meteorInstall;
var Promise = Package.promise.Promise;

/* Package-scope variables */
var ReactMeteorData;

var require = meteorInstall({"node_modules":{"meteor":{"react-meteor-data":{"react-meteor-data.jsx":function module(require,exports,module){

///////////////////////////////////////////////////////////////////////////////////////////
//                                                                                       //
// packages/react-meteor-data/react-meteor-data.jsx                                      //
//                                                                                       //
///////////////////////////////////////////////////////////////////////////////////////////
                                                                                         //
let checkNpmVersions;
module.link("meteor/tmeasday:check-npm-versions", {
  checkNpmVersions(v) {
    checkNpmVersions = v;
  }

}, 0);
module.link("./createContainer.jsx", {
  default: "createContainer"
}, 1);
module.link("./ReactMeteorData.jsx", {
  default: "withTracker"
}, 2);
module.link("./ReactMeteorData.jsx", {
  ReactMeteorData: "ReactMeteorData"
}, 3);
checkNpmVersions({
  react: '15.3 - 16'
}, 'react-meteor-data');
///////////////////////////////////////////////////////////////////////////////////////////

},"ReactMeteorData.jsx":function module(require,exports,module){

///////////////////////////////////////////////////////////////////////////////////////////
//                                                                                       //
// packages/react-meteor-data/ReactMeteorData.jsx                                        //
//                                                                                       //
///////////////////////////////////////////////////////////////////////////////////////////
                                                                                         //
let _extends;

module.link("@babel/runtime/helpers/extends", {
  default(v) {
    _extends = v;
  }

}, 0);
module.export({
  ReactMeteorData: () => ReactMeteorData,
  default: () => connect
});
let React;
module.link("react", {
  default(v) {
    React = v;
  }

}, 0);
let Meteor;
module.link("meteor/meteor", {
  Meteor(v) {
    Meteor = v;
  }

}, 1);
let Tracker;
module.link("meteor/tracker", {
  Tracker(v) {
    Tracker = v;
  }

}, 2);

// A class to keep the state and utility methods needed to manage
// the Meteor data for a component.
class MeteorDataManager {
  constructor(component) {
    this.component = component;
    this.computation = null;
    this.oldData = null;
  }

  dispose() {
    if (this.computation) {
      this.computation.stop();
      this.computation = null;
    }
  }

  calculateData() {
    const component = this.component;

    if (!component.getMeteorData) {
      return null;
    } // When rendering on the server, we don't want to use the Tracker.
    // We only do the first rendering on the server so we can get the data right away


    if (Meteor.isServer) {
      return component.getMeteorData();
    }

    if (this.computation) {
      this.computation.stop();
      this.computation = null;
    }

    let data; // Use Tracker.nonreactive in case we are inside a Tracker Computation.
    // This can happen if someone calls `ReactDOM.render` inside a Computation.
    // In that case, we want to opt out of the normal behavior of nested
    // Computations, where if the outer one is invalidated or stopped,
    // it stops the inner one.

    this.computation = Tracker.nonreactive(() => Tracker.autorun(c => {
      if (c.firstRun) {
        const savedSetState = component.setState;

        try {
          component.setState = () => {
            throw new Error('Can\'t call `setState` inside `getMeteorData` as this could ' + 'cause an endless loop. To respond to Meteor data changing, ' + 'consider making this component a \"wrapper component\" that ' + 'only fetches data and passes it in as props to a child ' + 'component. Then you can use `componentWillReceiveProps` in ' + 'that child component.');
          };

          data = component.getMeteorData();
        } finally {
          component.setState = savedSetState;
        }
      } else {
        // Stop this computation instead of using the re-run.
        // We use a brand-new autorun for each call to getMeteorData
        // to capture dependencies on any reactive data sources that
        // are accessed.  The reason we can't use a single autorun
        // for the lifetime of the component is that Tracker only
        // re-runs autoruns at flush time, while we need to be able to
        // re-call getMeteorData synchronously whenever we want, e.g.
        // from componentWillUpdate.
        c.stop(); // Calling forceUpdate() triggers componentWillUpdate which
        // recalculates getMeteorData() and re-renders the component.

        component.forceUpdate();
      }
    }));

    if (Package.mongo && Package.mongo.Mongo) {
      Object.keys(data).forEach(key => {
        if (data[key] instanceof Package.mongo.Mongo.Cursor) {
          console.warn('Warning: you are returning a Mongo cursor from getMeteorData. ' + 'This value will not be reactive. You probably want to call ' + '`.fetch()` on the cursor before returning it.');
        }
      });
    }

    return data;
  }

  updateData(newData) {
    const component = this.component;
    const oldData = this.oldData;

    if (!(newData && typeof newData === 'object')) {
      throw new Error('Expected object returned from getMeteorData');
    } // update componentData in place based on newData


    for (let key in newData) {
      component.data[key] = newData[key];
    } // if there is oldData (which is every time this method is called
    // except the first), delete keys in newData that aren't in
    // oldData.  don't interfere with other keys, in case we are
    // co-existing with something else that writes to a component's
    // this.data.


    if (oldData) {
      for (let key in oldData) {
        if (!(key in newData)) {
          delete component.data[key];
        }
      }
    }

    this.oldData = newData;
  }

}

const ReactMeteorData = {
  componentWillMount() {
    this.data = {};
    this._meteorDataManager = new MeteorDataManager(this);

    const newData = this._meteorDataManager.calculateData();

    this._meteorDataManager.updateData(newData);
  },

  componentWillUpdate(nextProps, nextState) {
    const saveProps = this.props;
    const saveState = this.state;
    let newData;

    try {
      // Temporarily assign this.state and this.props,
      // so that they are seen by getMeteorData!
      // This is a simulation of how the proposed Observe API
      // for React will work, which calls observe() after
      // componentWillUpdate and after props and state are
      // updated, but before render() is called.
      // See https://github.com/facebook/react/issues/3398.
      this.props = nextProps;
      this.state = nextState;
      newData = this._meteorDataManager.calculateData();
    } finally {
      this.props = saveProps;
      this.state = saveState;
    }

    this._meteorDataManager.updateData(newData);
  },

  componentWillUnmount() {
    this._meteorDataManager.dispose();
  }

};

class ReactComponent extends React.Component {}

Object.assign(ReactComponent.prototype, ReactMeteorData);

class ReactPureComponent extends React.PureComponent {}

Object.assign(ReactPureComponent.prototype, ReactMeteorData);

function connect(options) {
  let expandedOptions = options;

  if (typeof options === 'function') {
    expandedOptions = {
      getMeteorData: options
    };
  }

  const {
    getMeteorData,
    pure = true
  } = expandedOptions;
  const BaseComponent = pure ? ReactPureComponent : ReactComponent;
  return WrappedComponent => class ReactMeteorDataComponent extends BaseComponent {
    getMeteorData() {
      return getMeteorData(this.props);
    }

    render() {
      return React.createElement(WrappedComponent, _extends({}, this.props, this.data));
    }

  };
}
///////////////////////////////////////////////////////////////////////////////////////////

},"createContainer.jsx":function module(require,exports,module){

///////////////////////////////////////////////////////////////////////////////////////////
//                                                                                       //
// packages/react-meteor-data/createContainer.jsx                                        //
//                                                                                       //
///////////////////////////////////////////////////////////////////////////////////////////
                                                                                         //
module.export({
  default: () => createContainer
});
let Meteor;
module.link("meteor/meteor", {
  Meteor(v) {
    Meteor = v;
  }

}, 0);
let React;
module.link("react", {
  default(v) {
    React = v;
  }

}, 1);
let connect;
module.link("./ReactMeteorData.jsx", {
  default(v) {
    connect = v;
  }

}, 2);
let hasDisplayedWarning = false;

function createContainer(options, Component) {
  if (!hasDisplayedWarning && Meteor.isDevelopment) {
    console.warn('Warning: createContainer was deprecated in react-meteor-data@0.2.13. Use withTracker instead.\n' + 'https://github.com/meteor/react-packages/tree/devel/packages/react-meteor-data#usage');
    hasDisplayedWarning = true;
  }

  return connect(options)(Component);
}
///////////////////////////////////////////////////////////////////////////////////////////

}}}}},{
  "extensions": [
    ".js",
    ".json",
    ".jsx"
  ]
});

var exports = require("/node_modules/meteor/react-meteor-data/react-meteor-data.jsx");

/* Exports */
Package._define("react-meteor-data", exports, {
  ReactMeteorData: ReactMeteorData
});

})();

//# sourceURL=meteor://💻app/packages/react-meteor-data.js
//# sourceMappingURL=data:application/json;charset=utf8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIm1ldGVvcjovL/CfkrthcHAvcGFja2FnZXMvcmVhY3QtbWV0ZW9yLWRhdGEvcmVhY3QtbWV0ZW9yLWRhdGEuanN4IiwibWV0ZW9yOi8v8J+Su2FwcC9wYWNrYWdlcy9yZWFjdC1tZXRlb3ItZGF0YS9SZWFjdE1ldGVvckRhdGEuanN4IiwibWV0ZW9yOi8v8J+Su2FwcC9wYWNrYWdlcy9yZWFjdC1tZXRlb3ItZGF0YS9jcmVhdGVDb250YWluZXIuanN4Il0sIm5hbWVzIjpbImNoZWNrTnBtVmVyc2lvbnMiLCJtb2R1bGUiLCJsaW5rIiwidiIsImRlZmF1bHQiLCJSZWFjdE1ldGVvckRhdGEiLCJyZWFjdCIsIl9leHRlbmRzIiwiZXhwb3J0IiwiY29ubmVjdCIsIlJlYWN0IiwiTWV0ZW9yIiwiVHJhY2tlciIsIk1ldGVvckRhdGFNYW5hZ2VyIiwiY29uc3RydWN0b3IiLCJjb21wb25lbnQiLCJjb21wdXRhdGlvbiIsIm9sZERhdGEiLCJkaXNwb3NlIiwic3RvcCIsImNhbGN1bGF0ZURhdGEiLCJnZXRNZXRlb3JEYXRhIiwiaXNTZXJ2ZXIiLCJkYXRhIiwibm9ucmVhY3RpdmUiLCJhdXRvcnVuIiwiYyIsImZpcnN0UnVuIiwic2F2ZWRTZXRTdGF0ZSIsInNldFN0YXRlIiwiRXJyb3IiLCJmb3JjZVVwZGF0ZSIsIlBhY2thZ2UiLCJtb25nbyIsIk1vbmdvIiwiT2JqZWN0Iiwia2V5cyIsImZvckVhY2giLCJrZXkiLCJDdXJzb3IiLCJjb25zb2xlIiwid2FybiIsInVwZGF0ZURhdGEiLCJuZXdEYXRhIiwiY29tcG9uZW50V2lsbE1vdW50IiwiX21ldGVvckRhdGFNYW5hZ2VyIiwiY29tcG9uZW50V2lsbFVwZGF0ZSIsIm5leHRQcm9wcyIsIm5leHRTdGF0ZSIsInNhdmVQcm9wcyIsInByb3BzIiwic2F2ZVN0YXRlIiwic3RhdGUiLCJjb21wb25lbnRXaWxsVW5tb3VudCIsIlJlYWN0Q29tcG9uZW50IiwiQ29tcG9uZW50IiwiYXNzaWduIiwicHJvdG90eXBlIiwiUmVhY3RQdXJlQ29tcG9uZW50IiwiUHVyZUNvbXBvbmVudCIsIm9wdGlvbnMiLCJleHBhbmRlZE9wdGlvbnMiLCJwdXJlIiwiQmFzZUNvbXBvbmVudCIsIldyYXBwZWRDb21wb25lbnQiLCJSZWFjdE1ldGVvckRhdGFDb21wb25lbnQiLCJyZW5kZXIiLCJjcmVhdGVDb250YWluZXIiLCJoYXNEaXNwbGF5ZWRXYXJuaW5nIiwiaXNEZXZlbG9wbWVudCJdLCJtYXBwaW5ncyI6Ijs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7QUFBQSxJQUFJQSxnQkFBSjtBQUFxQkMsTUFBTSxDQUFDQyxJQUFQLENBQVksb0NBQVosRUFBaUQ7QUFBQ0Ysa0JBQWdCLENBQUNHLENBQUQsRUFBRztBQUFDSCxvQkFBZ0IsR0FBQ0csQ0FBakI7QUFBbUI7O0FBQXhDLENBQWpELEVBQTJGLENBQTNGO0FBQThGRixNQUFNLENBQUNDLElBQVAsQ0FBWSx1QkFBWixFQUFvQztBQUFDRSxTQUFPLEVBQUM7QUFBVCxDQUFwQyxFQUFnRSxDQUFoRTtBQUFtRUgsTUFBTSxDQUFDQyxJQUFQLENBQVksdUJBQVosRUFBb0M7QUFBQ0UsU0FBTyxFQUFDO0FBQVQsQ0FBcEMsRUFBNEQsQ0FBNUQ7QUFBK0RILE1BQU0sQ0FBQ0MsSUFBUCxDQUFZLHVCQUFaLEVBQW9DO0FBQUNHLGlCQUFlLEVBQUM7QUFBakIsQ0FBcEMsRUFBd0UsQ0FBeEU7QUFFclBMLGdCQUFnQixDQUFDO0FBQ2ZNLE9BQUssRUFBRTtBQURRLENBQUQsRUFFYixtQkFGYSxDQUFoQixDOzs7Ozs7Ozs7OztBQ0ZBLElBQUlDLFFBQUo7O0FBQWFOLE1BQU0sQ0FBQ0MsSUFBUCxDQUFZLGdDQUFaLEVBQTZDO0FBQUNFLFNBQU8sQ0FBQ0QsQ0FBRCxFQUFHO0FBQUNJLFlBQVEsR0FBQ0osQ0FBVDtBQUFXOztBQUF2QixDQUE3QyxFQUFzRSxDQUF0RTtBQUFiRixNQUFNLENBQUNPLE1BQVAsQ0FBYztBQUFDSCxpQkFBZSxFQUFDLE1BQUlBLGVBQXJCO0FBQXFDRCxTQUFPLEVBQUMsTUFB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QUFrRDtBQUNoRDdCLFdBQU8sQ0FBQ0MsSUFBUixDQUNFLG9HQUNFLHNGQUZKO0FBSUEyQix1QkFBbUIsR0FBRyxJQUF0QjtBQUNEOztBQUVELFNBQU8zRCxPQUFPLENBQUNtRCxPQUFELENBQVAsQ0FBaUJMLFNBQWpCLENBQVA7QUFDRCxDIiwiZmlsZSI6Ii9wYWNrYWdlcy9yZWFjdC1tZXRlb3ItZGF0YS5qcyIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCB7IGNoZWNrTnBtVmVyc2lvbnMgfSBmcm9tICdtZXRlb3IvdG1lYXNkYXk6Y2hlY2stbnBtLXZlcnNpb25zJztcblxuY2hlY2tOcG1WZXJzaW9ucyh7XG4gIHJlYWN0OiAnMTUuMyAtIDE2Jyxcbn0sICdyZWFjdC1tZXRlb3ItZGF0YScpO1xuXG5leHBvcnQgeyBkZWZhdWx0IGFzIGNyZWF0ZUNvbnRhaW5lciB9IGZyb20gJy4vY3JlYXRlQ29udGFpbmVyLmpzeCc7XG5leHBvcnQgeyBkZWZhdWx0IGFzIHdpdGhUcmFja2VyIH0gZnJvbSAnLi9SZWFjdE1ldGVvckRhdGEuanN4JztcbmV4cG9ydCB7IFJlYWN0TWV0ZW9yRGF0YSB9IGZyb20gJy4vUmVhY3RNZXRlb3JEYXRhLmpzeCc7XG4iLCIvKiBnbG9iYWwgUGFja2FnZSAqL1xuLyogZXNsaW50LWRpc2FibGUgcmVhY3QvcHJlZmVyLXN0YXRlbGVzcy1mdW5jdGlvbiAqL1xuXG5pbXBvcnQgUmVhY3QgZnJvbSAncmVhY3QnO1xuaW1wb3J0IHsgTWV0ZW9yIH0gZnJvbSAnbWV0ZW9yL21ldGVvcic7XG5pbXBvcnQgeyBUcmFja2VyIH0gZnJvbSAnbWV0ZW9yL3RyYWNrZXInO1xuXG4vLyBBIGNsYXNzIHRvIGtlZXAgdGhlIHN0YXRlIGFuZCB1dGlsaXR5IG1ldGhvZHMgbmVlZGVkIHRvIG1hbmFnZVxuLy8gdGhlIE1ldGVvciBkYXRhIGZvciBhIGNvbXBvbmVudC5cbmNsYXNzIE1ldGVvckRhdGFNYW5hZ2VyIHtcbiAgY29uc3RydWN0b3IoY29tcG9uZW50KSB7XG4gICAgdGhpcy5jb21wb25lbnQgPSBjb21wb25lbnQ7XG4gICAgdGhpcy5jb21wdXRhdGlvbiA9IG51bGw7XG4gICAgdGhpcy5vbGREYXRhID0gbnVsbDtcbiAgfVxuXG4gIGRpc3Bvc2UoKSB7XG4gICAgaWYgKHRoaXMuY29tcHV0YXRpb24pIHtcbiAgICAgIHRoaXMuY29tcHV0YXRpb24uc3RvcCgpO1xuICAgICAgdGhpcy5jb21wdXRhdGlvbiA9IG51bGw7XG4gICAgfVxuICB9XG5cbiAgY2FsY3VsYXRlRGF0YSgpIHtcbiAgICBjb25zdCBjb21wb25lbnQgPSB0aGlzLmNvbXBvbmVudDtcblxuICAgIGlmICghY29tcG9uZW50LmdldE1ldGVvckRhdGEpIHtcbiAgICAgIHJldHVybiBudWxsO1xuICAgIH1cblxuICAgIC8vIFdoZW4gcmVuZGVyaW5nIG9uIHRoZSBzZXJ2ZXIsIHdlIGRvbid0IHdhbnQgdG8gdXNlIHRoZSBUcmFja2VyLlxuICAgIC8vIFdlIG9ubHkgZG8gdGhlIGZpcnN0IHJlbmRlcmluZyBvbiB0aGUgc2VydmVyIHNvIHdlIGNhbiBnZXQgdGhlIGRhdGEgcmlnaHQgYXdheVxuICAgIGlmIChNZXRlb3IuaXNTZXJ2ZXIpIHtcbiAgICAgIHJldHVybiBjb21wb25lbnQuZ2V0TWV0ZW9yRGF0YSgpO1xuICAgIH1cblxuICAgIGlmICh0aGlzLmNvbXB1dGF0aW9uKSB7XG4gICAgICB0aGlzLmNvbXB1dGF0aW9uLnN0b3AoKTtcbiAgICAgIHRoaXMuY29tcHV0YXRpb24gPSBudWxsO1xuICAgIH1cblxuICAgIGxldCBkYXRhO1xuICAgIC8vIFVzZSBUcmFja2VyLm5vbnJlYWN0aXZlIGluIGNhc2Ugd2UgYXJlIGluc2lkZSBhIFRyYWNrZXIgQ29tcHV0YXRpb24uXG4gICAgLy8gVGhpcyBjYW4gaGFwcGVuIGlmIHNvbWVvbmUgY2FsbHMgYFJlYWN0RE9NLnJlbmRlcmAgaW5zaWRlIGEgQ29tcHV0YXRpb24uXG4gICAgLy8gSW4gdGhhdCBjYXNlLCB3ZSB3YW50IHRvIG9wdCBvdXQgb2YgdGhlIG5vcm1hbCBiZWhhdmlvciBvZiBuZXN0ZWRcbiAgICAvLyBDb21wdXRhdGlvbnMsIHdoZXJlIGlmIHRoZSBvdXRlciBvbmUgaXMgaW52YWxpZGF0ZWQgb3Igc3RvcHBlZCxcbiAgICAvLyBpdCBzdG9wcyB0aGUgaW5uZXIgb25lLlxuICAgIHRoaXMuY29tcHV0YXRpb24gPSBUcmFja2VyLm5vbnJlYWN0aXZlKCgpID0+IChcbiAgICAgIFRyYWNrZXIuYXV0b3J1bigoYykgPT4ge1xuICAgICAgICBpZiAoYy5maXJzdFJ1bikge1xuICAgICAgICAgIGNvbnN0IHNhdmVkU2V0U3RhdGUgPSBjb21wb25lbnQuc2V0U3RhdGU7XG4gICAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgIGNvbXBvbmVudC5zZXRTdGF0ZSA9ICgpID0+IHtcbiAgICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKFxuICAgICAgICAgICAgICAgICdDYW5cXCd0IGNhbGwgYHNldFN0YXRlYCBpbnNpZGUgYGdldE1ldGVvckRhdGFgIGFzIHRoaXMgY291bGQgJ1xuICAgICAgICAgICAgICAgICsgJ2NhdXNlIGFuIGVuZGxlc3MgbG9vcC4gVG8gcmVzcG9uZCB0byBNZXRlb3IgZGF0YSBjaGFuZ2luZywgJ1xuICAgICAgICAgICAgICAgICsgJ2NvbnNpZGVyIG1ha2luZyB0aGlzIGNvbXBvbmVudCBhIFxcXCJ3cmFwcGVyIGNvbXBvbmVudFxcXCIgdGhhdCAnXG4gICAgICAgICAgICAgICAgKyAnb25seSBmZXRjaGVzIGRhdGEgYW5kIHBhc3NlcyBpdCBpbiBhcyBwcm9wcyB0byBhIGNoaWxkICdcbiAgICAgICAgICAgICAgICArICdjb21wb25lbnQuIFRoZW4geW91IGNhbiB1c2UgYGNvbXBvbmVudFdpbGxSZWNlaXZlUHJvcHNgIGluICdcbiAgICAgICAgICAgICAgICArICd0aGF0IGNoaWxkIGNvbXBvbmVudC4nKTtcbiAgICAgICAgICAgIH07XG5cbiAgICAgICAgICAgIGRhdGEgPSBjb21wb25lbnQuZ2V0TWV0ZW9yRGF0YSgpO1xuICAgICAgICAgIH0gZmluYWxseSB7XG4gICAgICAgICAgICBjb21wb25lbnQuc2V0U3RhdGUgPSBzYXZlZFNldFN0YXRlO1xuICAgICAgICAgIH1cbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAvLyBTdG9wIHRoaXMgY29tcHV0YXRpb24gaW5zdGVhZCBvZiB1c2luZyB0aGUgcmUtcnVuLlxuICAgICAgICAgIC8vIFdlIHVzZSBhIGJyYW5kLW5ldyBhdXRvcnVuIGZvciBlYWNoIGNhbGwgdG8gZ2V0TWV0ZW9yRGF0YVxuICAgICAgICAgIC8vIHRvIGNhcHR1cmUgZGVwZW5kZW5jaWVzIG9uIGFueSByZWFjdGl2ZSBkYXRhIHNvdXJjZXMgdGhhdFxuICAgICAgICAgIC8vIGFyZSBhY2Nlc3NlZC4gIFRoZSByZWFzb24gd2UgY2FuJ3QgdXNlIGEgc2luZ2xlIGF1dG9ydW5cbiAgICAgICAgICAvLyBmb3IgdGhlIGxpZmV0aW1lIG9mIHRoZSBjb21wb25lbnQgaXMgdGhhdCBUcmFja2VyIG9ubHlcbiAgICAgICAgICAvLyByZS1ydW5zIGF1dG9ydW5zIGF0IGZsdXNoIHRpbWUsIHdoaWxlIHdlIG5lZWQgdG8gYmUgYWJsZSB0b1xuICAgICAgICAgIC8vIHJlLWNhbGwgZ2V0TWV0ZW9yRGF0YSBzeW5jaHJvbm91c2x5IHdoZW5ldmVyIHdlIHdhbnQsIGUuZy5cbiAgICAgICAgICAvLyBmcm9tIGNvbXBvbmVudFdpbGxVcGRhdGUuXG4gICAgICAgICAgYy5zdG9wKCk7XG4gICAgICAgICAgLy8gQ2FsbGluZyBmb3JjZVVwZGF0ZSgpIHRyaWdnZXJzIGNvbXBvbmVudFdpbGxVcGRhdGUgd2hpY2hcbiAgICAgICAgICAvLyByZWNhbGN1bGF0ZXMgZ2V0TWV0ZW9yRGF0YSgpIGFuZCByZS1yZW5kZXJzIHRoZSBjb21wb25lbnQuXG4gICAgICAgICAgY29tcG9uZW50LmZvcmNlVXBkYXRlKCk7XG4gICAgICAgIH1cbiAgICAgIH0pXG4gICAgKSk7XG5cbiAgICBpZiAoUGFja2FnZS5tb25nbyAmJiBQYWNrYWdlLm1vbmdvLk1vbmdvKSB7XG4gICAgICBPYmplY3Qua2V5cyhkYXRhKS5mb3JFYWNoKChrZXkpID0+IHtcbiAgICAgICAgaWYgKGRhdGFba2V5XSBpbnN0YW5jZW9mIFBhY2thZ2UubW9uZ28uTW9uZ28uQ3Vyc29yKSB7XG4gICAgICAgICAgY29uc29sZS53YXJuKFxuICAgICAgICAgICAgJ1dhcm5pbmc6IHlvdSBhcmUgcmV0dXJuaW5nIGEgTW9uZ28gY3Vyc29yIGZyb20gZ2V0TWV0ZW9yRGF0YS4gJ1xuICAgICAgICAgICAgKyAnVGhpcyB2YWx1ZSB3aWxsIG5vdCBiZSByZWFjdGl2ZS4gWW91IHByb2JhYmx5IHdhbnQgdG8gY2FsbCAnXG4gICAgICAgICAgICArICdgLmZldGNoKClgIG9uIHRoZSBjdXJzb3IgYmVmb3JlIHJldHVybmluZyBpdC4nXG4gICAgICAgICAgKTtcbiAgICAgICAgfVxuICAgICAgfSk7XG4gICAgfVxuXG4gICAgcmV0dXJuIGRhdGE7XG4gIH1cblxuICB1cGRhdGVEYXRhKG5ld0RhdGEpIHtcbiAgICBjb25zdCBjb21wb25lbnQgPSB0aGlzLmNvbXBvbmVudDtcbiAgICBjb25zdCBvbGREYXRhID0gdGhpcy5vbGREYXRhO1xuXG4gICAgaWYgKCEobmV3RGF0YSAmJiAodHlwZW9mIG5ld0RhdGEpID09PSAnb2JqZWN0JykpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcignRXhwZWN0ZWQgb2JqZWN0IHJldHVybmVkIGZyb20gZ2V0TWV0ZW9yRGF0YScpO1xuICAgIH1cbiAgICAvLyB1cGRhdGUgY29tcG9uZW50RGF0YSBpbiBwbGFjZSBiYXNlZCBvbiBuZXdEYXRhXG4gICAgZm9yIChsZXQga2V5IGluIG5ld0RhdGEpIHtcbiAgICAgIGNvbXBvbmVudC5kYXRhW2tleV0gPSBuZXdEYXRhW2tleV07XG4gICAgfVxuICAgIC8vIGlmIHRoZXJlIGlzIG9sZERhdGEgKHdoaWNoIGlzIGV2ZXJ5IHRpbWUgdGhpcyBtZXRob2QgaXMgY2FsbGVkXG4gICAgLy8gZXhjZXB0IHRoZSBmaXJzdCksIGRlbGV0ZSBrZXlzIGluIG5ld0RhdGEgdGhhdCBhcmVuJ3QgaW5cbiAgICAvLyBvbGREYXRhLiAgZG9uJ3QgaW50ZXJmZXJlIHdpdGggb3RoZXIga2V5cywgaW4gY2FzZSB3ZSBhcmVcbiAgICAvLyBjby1leGlzdGluZyB3aXRoIHNvbWV0aGluZyBlbHNlIHRoYXQgd3JpdGVzIHRvIGEgY29tcG9uZW50J3NcbiAgICAvLyB0aGlzLmRhdGEuXG4gICAgaWYgKG9sZERhdGEpIHtcbiAgICAgIGZvciAobGV0IGtleSBpbiBvbGREYXRhKSB7XG4gICAgICAgIGlmICghKGtleSBpbiBuZXdEYXRhKSkge1xuICAgICAgICAgIGRlbGV0ZSBjb21wb25lbnQuZGF0YVtrZXldO1xuICAgICAgICB9XG4gICAgICB9XG4gICAgfVxuICAgIHRoaXMub2xkRGF0YSA9IG5ld0RhdGE7XG4gIH1cbn1cblxuZXhwb3J0IGNvbnN0IFJlYWN0TWV0ZW9yRGF0YSA9IHtcbiAgY29tcG9uZW50V2lsbE1vdW50KCkge1xuICAgIHRoaXMuZGF0YSA9IHt9O1xuICAgIHRoaXMuX21ldGVvckRhdGFNYW5hZ2VyID0gbmV3IE1ldGVvckRhdGFNYW5hZ2VyKHRoaXMpO1xuICAgIGNvbnN0IG5ld0RhdGEgPSB0aGlzLl9tZXRlb3JEYXRhTWFuYWdlci5jYWxjdWxhdGVEYXRhKCk7XG4gICAgdGhpcy5fbWV0ZW9yRGF0YU1hbmFnZXIudXBkYXRlRGF0YShuZXdEYXRhKTtcbiAgfSxcblxuICBjb21wb25lbnRXaWxsVXBkYXRlKG5leHRQcm9wcywgbmV4dFN0YXRlKSB7XG4gICAgY29uc3Qgc2F2ZVByb3BzID0gdGhpcy5wcm9wcztcbiAgICBjb25zdCBzYXZlU3RhdGUgPSB0aGlzLnN0YXRlO1xuICAgIGxldCBuZXdEYXRhO1xuICAgIHRyeSB7XG4gICAgICAvLyBUZW1wb3JhcmlseSBhc3NpZ24gdGhpcy5zdGF0ZSBhbmQgdGhpcy5wcm9wcyxcbiAgICAgIC8vIHNvIHRoYXQgdGhleSBhcmUgc2VlbiBieSBnZXRNZXRlb3JEYXRhIVxuICAgICAgLy8gVGhpcyBpcyBhIHNpbXVsYXRpb24gb2YgaG93IHRoZSBwcm9wb3NlZCBPYnNlcnZlIEFQSVxuICAgICAgLy8gZm9yIFJlYWN0IHdpbGwgd29yaywgd2hpY2ggY2FsbHMgb2JzZXJ2ZSgpIGFmdGVyXG4gICAgICAvLyBjb21wb25lbnRXaWxsVXBkYXRlIGFuZCBhZnRlciBwcm9wcyBhbmQgc3RhdGUgYXJlXG4gICAgICAvLyB1cGRhdGVkLCBidXQgYmVmb3JlIHJlbmRlcigpIGlzIGNhbGxlZC5cbiAgICAgIC8vIFNlZSBodHRwczovL2dpdGh1Yi5jb20vZmFjZWJvb2svcmVhY3QvaXNzdWVzLzMzOTguXG4gICAgICB0aGlzLnByb3BzID0gbmV4dFByb3BzO1xuICAgICAgdGhpcy5zdGF0ZSA9IG5leHRTdGF0ZTtcbiAgICAgIG5ld0RhdGEgPSB0aGlzLl9tZXRlb3JEYXRhTWFuYWdlci5jYWxjdWxhdGVEYXRhKCk7XG4gICAgfSBmaW5hbGx5IHtcbiAgICAgIHRoaXMucHJvcHMgPSBzYXZlUHJvcHM7XG4gICAgICB0aGlzLnN0YXRlID0gc2F2ZVN0YXRlO1xuICAgIH1cblxuICAgIHRoaXMuX21ldGVvckRhdGFNYW5hZ2VyLnVwZGF0ZURhdGEobmV3RGF0YSk7XG4gIH0sXG5cbiAgY29tcG9uZW50V2lsbFVubW91bnQoKSB7XG4gICAgdGhpcy5fbWV0ZW9yRGF0YU1hbmFnZXIuZGlzcG9zZSgpO1xuICB9LFxufTtcblxuY2xhc3MgUmVhY3RDb21wb25lbnQgZXh0ZW5kcyBSZWFjdC5Db21wb25lbnQge31cbk9iamVjdC5hc3NpZ24oUmVhY3RDb21wb25lbnQucHJvdG90eXBlLCBSZWFjdE1ldGVvckRhdGEpO1xuY2xhc3MgUmVhY3RQdXJlQ29tcG9uZW50IGV4dGVuZHMgUmVhY3QuUHVyZUNvbXBvbmVudCB7fVxuT2JqZWN0LmFzc2lnbihSZWFjdFB1cmVDb21wb25lbnQucHJvdG90eXBlLCBSZWFjdE1ldGVvckRhdGEpO1xuXG5leHBvcnQgZGVmYXVsdCBmdW5jdGlvbiBjb25uZWN0KG9wdGlvbnMpIHtcbiAgbGV0IGV4cGFuZGVkT3B0aW9ucyA9IG9wdGlvbnM7XG4gIGlmICh0eXBlb2Ygb3B0aW9ucyA9PT0gJ2Z1bmN0aW9uJykge1xuICAgIGV4cGFuZGVkT3B0aW9ucyA9IHtcbiAgICAgIGdldE1ldGVvckRhdGE6IG9wdGlvbnMsXG4gICAgfTtcbiAgfVxuXG4gIGNvbnN0IHsgZ2V0TWV0ZW9yRGF0YSwgcHVyZSA9IHRydWUgfSA9IGV4cGFuZGVkT3B0aW9ucztcblxuICBjb25zdCBCYXNlQ29tcG9uZW50ID0gcHVyZSA/IFJlYWN0UHVyZUNvbXBvbmVudCA6IFJlYWN0Q29tcG9uZW50O1xuICByZXR1cm4gKFdyYXBwZWRDb21wb25lbnQpID0+IChcbiAgICBjbGFzcyBSZWFjdE1ldGVvckRhdGFDb21wb25lbnQgZXh0ZW5kcyBCYXNlQ29tcG9uZW50IHtcbiAgICAgIGdldE1ldGVvckRhdGEoKSB7XG4gICAgICAgIHJldHVybiBnZXRNZXRlb3JEYXRhKHRoaXMucHJvcHMpO1xuICAgICAgfVxuICAgICAgcmVuZGVyKCkge1xuICAgICAgICByZXR1cm4gPFdyYXBwZWRDb21wb25lbnQgey4uLnRoaXMucHJvcHN9IHsuLi50aGlzLmRhdGF9IC8+O1xuICAgICAgfVxuICAgIH1cbiAgKTtcbn1cbiIsIi8qKlxuICogQ29udGFpbmVyIGhlbHBlciB1c2luZyByZWFjdC1tZXRlb3ItZGF0YS5cbiAqL1xuXG5pbXBvcnQgeyBNZXRlb3IgfSBmcm9tICdtZXRlb3IvbWV0ZW9yJztcbmltcG9ydCBSZWFjdCBmcm9tICdyZWFjdCc7XG5pbXBvcnQgY29ubmVjdCBmcm9tICcuL1JlYWN0TWV0ZW9yRGF0YS5qc3gnO1xuXG5sZXQgaGFzRGlzcGxheWVkV2FybmluZyA9IGZhbHNlO1xuXG5leHBvcnQgZGVmYXVsdCBmdW5jdGlvbiBjcmVhdGVDb250YWluZXIob3B0aW9ucywgQ29tcG9uZW50KSB7XG4gIGlmICghaGFzRGlzcGxheWVkV2FybmluZyAmJiBNZXRlb3IuaXNEZXZlbG9wbWVudCkge1xuICAgIGNvbnNvbGUud2FybihcbiAgICAgICdXYXJuaW5nOiBjcmVhdGVDb250YWluZXIgd2FzIGRlcHJlY2F0ZWQgaW4gcmVhY3QtbWV0ZW9yLWRhdGFAMC4yLjEzLiBVc2Ugd2l0aFRyYWNrZXIgaW5zdGVhZC5cXG4nICtcbiAgICAgICAgJ2h0dHBzOi8vZ2l0aHViLmNvbS9tZXRlb3IvcmVhY3QtcGFja2FnZXMvdHJlZS9kZXZlbC9wYWNrYWdlcy9yZWFjdC1tZXRlb3ItZGF0YSN1c2FnZScsXG4gICAgKTtcbiAgICBoYXNEaXNwbGF5ZWRXYXJuaW5nID0gdHJ1ZTtcbiAgfVxuXG4gIHJldHVybiBjb25uZWN0KG9wdGlvbnMpKENvbXBvbmVudCk7XG59XG4iXX0=
