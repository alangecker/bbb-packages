(this["webpackJsonpactivity-report-app"]=this["webpackJsonpactivity-report-app"]||[]).push([[0],{32:function(e,t,s){},33:function(e,t,s){},34:function(e,t,s){},38:function(e,t,s){"use strict";s.r(t);var a=s(10),n=s(11),r=s(13),i=s(12),l=s(3),c=s.n(l),o=s(23),d=s.n(o),j=(s(32),s(18)),u=(s(33),s(34),s(22)),b=s(14),m=s(9),h=s(0);var p=function(e){var t=e.number,s=e.name,a=e.children,n=e.iconClass,r=e.cardClass;return Object(h.jsxs)("div",{className:"flex items-center justify-between p-4 bg-white rounded-md shadow border-l-8 ".concat(r),children:[Object(h.jsxs)("div",{className:"w-70",children:[Object(h.jsx)("p",{className:"text-lg font-semibold text-gray-700",children:t}),Object(h.jsx)("p",{className:"mb-2 text-sm font-medium text-gray-600",children:s})]}),Object(h.jsx)("div",{className:"p-3 mr-4 text-orange-500 rounded-full ".concat(n),children:a})]})},x=function(e){Object(r.a)(s,e);var t=Object(i.a)(s);function s(){return Object(a.a)(this,s),t.apply(this,arguments)}return Object(n.a)(s,[{key:"render",value:function(){var e=this.props,t=e.allUsers,s=e.totalOfActivityTime;function a(e){return e.reduce((function(e,t){return t.stoppedOn>0?e+(t.stoppedOn-t.startedOn):e+((new Date).getTime()-t.startedOn)}),0)}function n(e,t){var a=(t>0?t:(new Date).getTime())-e;return Math.ceil(a/s*100)}function r(e){return new Date(e).toISOString().substr(11,8)}return Object(h.jsxs)("table",{className:"w-full whitespace-no-wrap",children:[Object(h.jsx)("thead",{children:Object(h.jsxs)("tr",{className:"text-xs font-semibold tracking-wide text-left text-gray-500 uppercase border-b bg-gray-100",children:[Object(h.jsx)("th",{className:"px-4 py-3",children:Object(h.jsx)(u.a,{id:"app.learningDashboard.participantsTable.colParticipant",defaultMessage:"Participant"})}),Object(h.jsx)("th",{className:"px-4 py-3 text-center",children:Object(h.jsx)(u.a,{id:"app.learningDashboard.participantsTable.colOnline",defaultMessage:"Online time"})}),Object(h.jsx)("th",{className:"px-4 py-3 text-center",children:Object(h.jsx)(u.a,{id:"app.learningDashboard.participantsTable.colTalk",defaultMessage:"Talk time"})}),Object(h.jsx)("th",{className:"px-4 py-3 text-center",children:Object(h.jsx)(u.a,{id:"app.learningDashboard.participantsTable.colWebcam",defaultMessage:"Webcam Time"})}),Object(h.jsx)("th",{className:"px-4 py-3 text-center",children:Object(h.jsx)(u.a,{id:"app.learningDashboard.participantsTable.colMessages",defaultMessage:"Messages"})}),Object(h.jsx)("th",{className:"px-4 py-3 text-left",children:Object(h.jsx)(u.a,{id:"app.learningDashboard.participantsTable.colEmojis",defaultMessage:"Emojis"})}),Object(h.jsx)("th",{className:"px-4 py-3 text-center",children:Object(h.jsx)(u.a,{id:"app.learningDashboard.participantsTable.colRaiseHands",defaultMessage:"Raise Hand"})}),Object(h.jsx)("th",{className:"px-4 py-3",children:Object(h.jsx)(u.a,{id:"app.learningDashboard.participantsTable.colStatus",defaultMessage:"Status"})})]})}),Object(h.jsx)("tbody",{className:"bg-white divide-y",children:"object"===typeof t&&Object.values(t||{}).length>0?Object.values(t||{}).sort((function(e,t){return!0===e.isModerator&&!1===t.isModerator?-1:!1===e.isModerator&&!0===t.isModerator?1:e.name<t.name?-1:e.name>t.name?1:0})).map((function(e){return Object(h.jsxs)("tr",{className:"text-gray-700",children:[Object(h.jsx)("td",{className:"px-4 py-3",children:Object(h.jsxs)("div",{className:"flex items-center text-sm",children:[Object(h.jsxs)("div",{className:"relative hidden w-8 h-8 mr-3 rounded-full md:block",children:[Object(h.jsx)("div",{className:"border-2 border-gray-800 items-center ".concat(e.isModerator?"rounded-md":"rounded-full"),children:Object(h.jsx)("svg",{xmlns:"http://www.w3.org/2000/svg",className:"h-full w-full p-1",fill:"none",viewBox:"0 0 24 24",stroke:"currentColor",children:e.isDialIn?Object(h.jsx)("path",{strokeLinecap:"round",strokeLinejoin:"round",strokeWidth:"2",d:"M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z"}):Object(h.jsx)("path",{strokeLinecap:"round",strokeLinejoin:"round",strokeWidth:"2",d:"M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"})})}),Object(h.jsx)("div",{className:"absolute inset-0 rounded-full shadow-inner","aria-hidden":"true"})]}),Object(h.jsxs)("div",{children:[Object(h.jsx)("p",{className:"font-semibold",children:e.name}),Object(h.jsxs)("p",{className:"text-xs text-gray-600 dark:text-gray-400",children:[Object(h.jsx)("svg",{xmlns:"http://www.w3.org/2000/svg",className:"h-4 w-4 inline",fill:"none",viewBox:"0 0 24 24",stroke:"currentColor",children:Object(h.jsx)("path",{strokeLinecap:"round",strokeLinejoin:"round",strokeWidth:"2",d:"M11 16l-4-4m0 0l4-4m-4 4h14m-5 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h7a3 3 0 013 3v1"})}),Object(h.jsx)(b.a,{value:e.registeredOn,month:"short",day:"numeric",hour:"2-digit",minute:"2-digit",second:"2-digit"})]}),e.leftOn>0?Object(h.jsxs)("p",{className:"text-xs text-gray-600 dark:text-gray-400",children:[Object(h.jsx)("svg",{xmlns:"http://www.w3.org/2000/svg",className:"h-4 w-4 inline",fill:"none",viewBox:"0 0 24 24",stroke:"currentColor",children:Object(h.jsx)("path",{strokeLinecap:"round",strokeLinejoin:"round",strokeWidth:"2",d:"M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"})}),Object(h.jsx)(b.a,{value:e.leftOn,month:"short",day:"numeric",hour:"2-digit",minute:"2-digit",second:"2-digit"})]}):null]})]})}),Object(h.jsxs)("td",{className:"px-4 py-3 text-sm text-center items-center",children:[Object(h.jsx)("svg",{xmlns:"http://www.w3.org/2000/svg",className:"h-4 w-4 mr-1 inline",fill:"none",viewBox:"0 0 24 24",stroke:"currentColor",children:Object(h.jsx)("path",{strokeLinecap:"round",strokeLinejoin:"round",strokeWidth:"2",d:"M5.636 18.364a9 9 0 010-12.728m12.728 0a9 9 0 010 12.728m-9.9-2.829a5 5 0 010-7.07m7.072 0a5 5 0 010 7.07M13 12a1 1 0 11-2 0 1 1 0 012 0z"})}),r((e.leftOn>0?e.leftOn:(new Date).getTime())-e.registeredOn),Object(h.jsx)("br",{}),Object(h.jsx)("div",{className:"bg-gray-200 transition-colors duration-500 rounded-full overflow-hidden",title:"".concat(n(e.registeredOn,e.leftOn).toString(),"%"),children:Object(h.jsx)("div",{"aria-label":" ",className:"bg-gradient-to-br from-green-100 to-green-600 transition-colors duration-900 h-1.5",style:{width:"".concat(n(e.registeredOn,e.leftOn).toString(),"%")},role:"progressbar"})})]}),Object(h.jsx)("td",{className:"px-4 py-3 text-sm text-center",children:e.talk.totalTime>0?Object(h.jsxs)("span",{className:"text-center",children:[Object(h.jsx)("svg",{xmlns:"http://www.w3.org/2000/svg",className:"h-4 w-4 mr-1 inline",fill:"none",viewBox:"0 0 24 24",stroke:"currentColor",children:Object(h.jsx)("path",{strokeLinecap:"round",strokeLinejoin:"round",strokeWidth:"2",d:"M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z"})}),r(e.talk.totalTime)]}):null}),Object(h.jsx)("td",{className:"px-4 py-3 text-sm text-center",children:a(e.webcams)>0?Object(h.jsxs)("span",{className:"text-center",children:[Object(h.jsx)("svg",{xmlns:"http://www.w3.org/2000/svg",className:"h-4 w-4 mr-1 inline",fill:"none",viewBox:"0 0 24 24",stroke:"currentColor",children:Object(h.jsx)("path",{strokeLinecap:"round",strokeLinejoin:"round",strokeWidth:"2",d:"M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z"})}),r(a(e.webcams))]}):null}),Object(h.jsx)("td",{className:"px-4 py-3 text-sm text-center",children:e.totalOfMessages>0?Object(h.jsxs)("span",{children:[Object(h.jsx)("svg",{xmlns:"http://www.w3.org/2000/svg",className:"h-4 w-4 mr-1 inline",fill:"none",viewBox:"0 0 24 24",stroke:"currentColor",children:Object(h.jsx)("path",{strokeLinecap:"round",strokeLinejoin:"round",strokeWidth:"2",d:"M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"})}),e.totalOfMessages]}):null}),Object(h.jsxs)("td",{className:"px-4 py-3 text-sm text-left",children:[e.emojis.filter((function(e){return"away"===e.name})).length>0?Object(h.jsxs)("div",{className:"text-xs",children:[Object(h.jsx)("i",{className:"icon-bbb-time text-sm"}),"\xa0",e.emojis.filter((function(e){return"away"===e.name})).length,"\xa0",Object(h.jsx)(u.a,{id:"app.actionsBar.emojiMenu.awayLabel",defaultMessage:"Away"})]}):null,e.emojis.filter((function(e){return"neutral"===e.name})).length>0?Object(h.jsxs)("div",{className:"text-xs",children:[Object(h.jsx)("i",{className:"icon-bbb-undecided text-sm"}),"\xa0",e.emojis.filter((function(e){return"neutral"===e.name})).length,"\xa0",Object(h.jsx)(u.a,{id:"app.actionsBar.emojiMenu.neutralLabel",defaultMessage:"Undecided"})]}):null,e.emojis.filter((function(e){return"confused"===e.name})).length>0?Object(h.jsxs)("div",{className:"text-xs",children:[Object(h.jsx)("i",{className:"icon-bbb-undecided text-sm"}),"\xa0",e.emojis.filter((function(e){return"confused"===e.name})).length,"\xa0",Object(h.jsx)(u.a,{id:"app.actionsBar.emojiMenu.confusedLabel",defaultMessage:"Confused"})]}):null,e.emojis.filter((function(e){return"sad"===e.name})).length>0?Object(h.jsxs)("div",{className:"text-xs",children:[Object(h.jsx)("i",{className:"icon-bbb-sad text-sm"}),"\xa0",e.emojis.filter((function(e){return"sad"===e.name})).length,"\xa0",Object(h.jsx)(u.a,{id:"app.actionsBar.emojiMenu.sadLabel",defaultMessage:"Sad"})]}):null,e.emojis.filter((function(e){return"happy"===e.name})).length>0?Object(h.jsxs)("div",{className:"text-xs",children:[Object(h.jsx)("i",{className:"icon-bbb-happy text-sm"}),"\xa0",e.emojis.filter((function(e){return"happy"===e.name})).length,"\xa0",Object(h.jsx)(u.a,{id:"app.actionsBar.emojiMenu.happyLabel",defaultMessage:"Happy"})]}):null,e.emojis.filter((function(e){return"applause"===e.name})).length>0?Object(h.jsxs)("div",{className:"text-xs",children:[Object(h.jsx)("i",{className:"icon-bbb-applause text-sm"}),"\xa0",e.emojis.filter((function(e){return"applause"===e.name})).length,"\xa0",Object(h.jsx)(u.a,{id:"app.actionsBar.emojiMenu.applauseLabel",defaultMessage:"Applaud"})]}):null,e.emojis.filter((function(e){return"thumbsUp"===e.name})).length>0?Object(h.jsxs)("div",{className:"text-xs",children:[Object(h.jsx)("i",{className:"icon-bbb-thumbs_up text-sm"}),"\xa0",e.emojis.filter((function(e){return"thumbsUp"===e.name})).length,"\xa0",Object(h.jsx)(u.a,{id:"app.actionsBar.emojiMenu.thumbsUpLabel",defaultMessage:"Thumbs up"})]}):null,e.emojis.filter((function(e){return"thumbsDown"===e.name})).length>0?Object(h.jsxs)("div",{className:"text-xs",children:[Object(h.jsx)("i",{className:"icon-bbb-thumbs_down text-sm"}),"\xa0",e.emojis.filter((function(e){return"thumbsDown"===e.name})).length,"\xa0",Object(h.jsx)(u.a,{id:"app.actionsBar.emojiMenu.thumbsDownLabel",defaultMessage:"Thumbs down"})]}):null]}),Object(h.jsx)("td",{className:"px-4 py-3 text-sm text-center",children:e.emojis.filter((function(e){return"raiseHand"===e.name})).length>0?Object(h.jsxs)("span",{children:[Object(h.jsx)("svg",{xmlns:"http://www.w3.org/2000/svg",className:"h-4 w-4 mr-1 inline",fill:"none",viewBox:"0 0 24 24",stroke:"currentColor",children:Object(h.jsx)("path",{strokeLinecap:"round",strokeLinejoin:"round",strokeWidth:"2",d:"M7 11.5V14m0-2.5v-6a1.5 1.5 0 113 0m-3 6a1.5 1.5 0 00-3 0v2a7.5 7.5 0 0015 0v-5a1.5 1.5 0 00-3 0m-6-3V11m0-5.5v-1a1.5 1.5 0 013 0v1m0 0V11m0-5.5a1.5 1.5 0 013 0v3m0 0V11"})}),e.emojis.filter((function(e){return"raiseHand"===e.name})).length]}):null}),Object(h.jsx)("td",{className:"px-4 py-3 text-xs",children:e.leftOn>0?Object(h.jsx)("span",{className:"px-2 py-1 font-semibold leading-tight text-red-700 bg-red-100 rounded-full",children:Object(h.jsx)(u.a,{id:"app.learningDashboard.participantsTable.userStatusOffline",defaultMessage:"Offline"})}):Object(h.jsx)("span",{className:"px-2 py-1 font-semibold leading-tight text-green-700 bg-green-100 rounded-full",children:Object(h.jsx)(u.a,{id:"app.learningDashboard.participantsTable.userStatusOnline",defaultMessage:"Online"})})})]},e)})):Object(h.jsx)("tr",{className:"text-gray-700",children:Object(h.jsx)("td",{colSpan:"8",className:"px-4 py-3 text-sm text-center",children:Object(h.jsx)(u.a,{id:"app.learningDashboard.participantsTable.noUsers",defaultMessage:"No users"})})})})]})}}]),s}(c.a.Component),O=Object(m.c)(x),g=function(e){Object(r.a)(s,e);var t=Object(i.a)(s);function s(){return Object(a.a)(this,s),t.apply(this,arguments)}return Object(n.a)(s,[{key:"render",value:function(){var e=this.props,t=e.allUsers,s=e.polls,a=this.props.intl;function n(e,t){return"undefined"!==typeof e.answers[t.pollId]?e.answers[t.pollId]:""}return Object(h.jsxs)("table",{className:"w-full whitespace-no-wrap",children:[Object(h.jsx)("thead",{children:Object(h.jsxs)("tr",{className:"text-xs font-semibold tracking-wide text-left text-gray-500 uppercase border-b bg-gray-100",children:[Object(h.jsx)("th",{className:"px-4 py-3",children:Object(h.jsx)(u.a,{id:"app.learningDashboard.pollsTable.colParticipant",defaultMessage:"Participant"})}),"object"===typeof s&&Object.values(s||{}).length>0?Object.values(s||{}).map((function(e,t){return Object(h.jsx)("th",{className:"px-4 py-3 text-center",children:e.question||"Poll ".concat(t+1)})})):null]})}),Object(h.jsxs)("tbody",{className:"bg-white divide-y",children:["object"===typeof t&&Object.values(t||{}).length>0?Object.values(t||{}).filter((function(e){return Object.values(e.answers).length>0})).map((function(e){return Object(h.jsxs)("tr",{className:"text-gray-700",children:[Object(h.jsx)("td",{className:"px-4 py-3",children:Object(h.jsxs)("div",{className:"flex items-center text-sm",children:[Object(h.jsxs)("div",{className:"relative hidden w-8 h-8 mr-3 rounded-full md:block",children:[Object(h.jsx)("svg",{xmlns:"http://www.w3.org/2000/svg",className:"relative hidden w-8 h-8 mr-3 rounded-full md:block",fill:"none",viewBox:"0 0 24 24",stroke:"currentColor",children:Object(h.jsx)("path",{strokeLinecap:"round",strokeLinejoin:"round",strokeWidth:"2",d:"M5.121 17.804A13.937 13.937 0 0112 16c2.5 0 4.847.655 6.879 1.804M15 10a3 3 0 11-6 0 3 3 0 016 0zm6 2a9 9 0 11-18 0 9 9 0 0118 0z"})}),Object(h.jsx)("div",{className:"absolute inset-0 rounded-full shadow-inner","aria-hidden":"true"})]}),Object(h.jsx)("div",{children:Object(h.jsx)("p",{className:"font-semibold",children:e.name})})]})}),"object"===typeof s&&Object.values(s||{}).length>0?Object.values(s||{}).map((function(t){return Object(h.jsxs)("td",{className:"px-4 py-3 text-sm text-center",children:[n(e,t),t.anonymous?Object(h.jsx)("span",{title:a.formatMessage({id:"app.learningDashboard.pollsTable.anonymousAnswer",defaultMessage:"Anonymous Poll (answers in the last row)"}),children:Object(h.jsx)("svg",{xmlns:"http://www.w3.org/2000/svg",className:"h-4 w-4 inline",fill:"none",viewBox:"0 0 24 24",stroke:"currentColor",children:Object(h.jsx)("path",{strokeLinecap:"round",strokeLinejoin:"round",strokeWidth:"2",d:"M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"})})}):null]})})):null]})})):null,Object(h.jsxs)("tr",{className:"text-gray-700",children:[Object(h.jsx)("td",{className:"px-4 py-3",children:Object(h.jsxs)("div",{className:"flex items-center text-sm",children:[Object(h.jsxs)("div",{className:"relative hidden w-8 h-8 mr-3 rounded-full md:block",children:[Object(h.jsx)("svg",{xmlns:"http://www.w3.org/2000/svg",className:"relative hidden w-8 h-8 mr-3 rounded-full md:block",fill:"none",viewBox:"0 0 24 24",stroke:"currentColor",children:Object(h.jsx)("path",{strokeLinecap:"round",strokeLinejoin:"round",strokeWidth:"2",d:"M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"})}),Object(h.jsx)("div",{className:"absolute inset-0 rounded-full shadow-inner","aria-hidden":"true"})]}),Object(h.jsx)("div",{children:Object(h.jsx)("p",{className:"font-semibold",children:Object(h.jsx)(u.a,{id:"app.learningDashboard.pollsTable.anonymousRowName",defaultMessage:"Anonymous"})})})]})}),"object"===typeof s&&Object.values(s||{}).length>0?Object.values(s||{}).map((function(e){return Object(h.jsx)("td",{className:"px-4 py-3 text-sm text-center",children:e.anonymousAnswers.map((function(e){return Object(h.jsx)("p",{children:e})}))})})):null]})]})]})}}]),s}(c.a.Component),f=Object(m.c)(g),v=function(e){Object(r.a)(s,e);var t=Object(i.a)(s);function s(e){var n;return Object(a.a)(this,s),(n=t.call(this,e)).state={activitiesJson:{},tab:"overview"},n}return Object(n.a)(s,[{key:"componentDidMount",value:function(){var e=this;this.fetchActivitiesJson(),setInterval((function(){e.fetchActivitiesJson()}),1e4)}},{key:"fetchActivitiesJson",value:function(){var e=this,t=new URLSearchParams(window.location.search),s=Object.fromEntries(t.entries());"undefined"!==typeof s.meeting&&"undefined"!==typeof s.report&&fetch("".concat(s.meeting,"/").concat(s.report,"/activity_report.json")).then((function(e){return e.json()})).then((function(t){e.setState({activitiesJson:t}),document.title="Learning Dashboard - ".concat(t.name)}))}},{key:"render",value:function(){var e,t=this,s=this.state,a=s.activitiesJson,n=s.tab,r=this.props.intl;function i(){var e=Object.values(a.users||{}).reduce((function(e,t){return 0===e||t.registeredOn<e?t.registeredOn:e}),0);return Object.values(a.users||{}).reduce((function(e,t){return 0===t.leftOn?(new Date).getTime():t.leftOn>e?t.leftOn:e}),0)-e}return Object(h.jsxs)("div",{className:"mx-10",children:[Object(h.jsxs)("div",{className:"flex items-start justify-between pb-3",children:[Object(h.jsxs)("h1",{className:"mt-3 text-2xl font-semibold whitespace-nowrap inline-block",children:[Object(h.jsx)(u.a,{id:"app.learningDashboard.dashboardTitle",defaultMessage:"Learning Dashboard"}),Object(h.jsx)("br",{}),Object(h.jsx)("span",{className:"text-sm font-medium",children:a.name||""})]}),Object(h.jsxs)("div",{className:"mt-3 text-right px-4 py-1 text-gray-500 inline-block",children:[Object(h.jsxs)("p",{className:"font-bold",children:[Object(h.jsx)(b.a,{value:a.createdOn,year:"numeric",month:"short",day:"numeric"}),a.endedOn>0?Object(h.jsx)("span",{className:"px-2 py-1 ml-3 font-semibold leading-tight text-red-700 bg-red-100 rounded-full",children:Object(h.jsx)(u.a,{id:"app.learningDashboard.indicators.meetingStatusEnded",defaultMessage:"Ended"})}):Object(h.jsx)("span",{className:"px-2 py-1 ml-3 font-semibold leading-tight text-green-700 bg-green-100 rounded-full",children:Object(h.jsx)(u.a,{id:"app.learningDashboard.indicators.meetingStatusActive",defaultMessage:"Active"})})]}),Object(h.jsxs)("p",{children:[Object(h.jsx)(u.a,{id:"app.learningDashboard.indicators.duration",defaultMessage:"Duration"}),":\xa0",(e=i(),new Date(e).toISOString().substr(11,8))]})]})]}),Object(h.jsxs)("div",{className:"grid gap-6 mb-8 md:grid-cols-2 xl:grid-cols-4",children:[Object(h.jsx)("div",{"aria-hidden":"true",className:"cursor-pointer",onClick:function(){t.setState({tab:"overview"})},children:Object(h.jsx)(p,{name:r.formatMessage({id:"app.learningDashboard.indicators.participants",defaultMessage:"Participants"}),number:Object.values(a.users||{}).length,cardClass:"border-pink-500",iconClass:"bg-pink-50 text-pink-500",onClick:function(){t.setState({tab:"overview"})},children:Object(h.jsx)("svg",{xmlns:"http://www.w3.org/2000/svg",className:"h-6 w-6",fill:"none",viewBox:"0 0 24 24",stroke:"currentColor",children:Object(h.jsx)("path",{strokeLinecap:"round",strokeLinejoin:"round",strokeWidth:"2",d:"M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z"})})})}),Object(h.jsx)("div",{"aria-hidden":"true",className:"cursor-pointer",onClick:function(){t.setState({tab:"polling"})},children:Object(h.jsx)(p,{name:r.formatMessage({id:"app.learningDashboard.indicators.polls",defaultMessage:"Polls"}),number:Object.values(a.polls||{}).length,cardClass:"border-blue-500",iconClass:"bg-blue-100 text-blue-500",children:Object(h.jsx)("svg",{xmlns:"http://www.w3.org/2000/svg",className:"h-6 w-6",fill:"none",viewBox:"0 0 24 24",stroke:"currentColor",children:Object(h.jsx)("path",{strokeLinecap:"round",strokeLinejoin:"round",strokeWidth:"2",d:"M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01"})})})}),Object(h.jsx)(p,{name:r.formatMessage({id:"app.learningDashboard.indicators.raiseHand",defaultMessage:"Raise Hand"}),number:a&&a.users?Object.values(a.users).reduce((function(e,t){return e+t.emojis.filter((function(e){return"raiseHand"===e.name})).length}),0):0,cardClass:"border-purple-500",iconClass:"bg-purple-200 text-purple-500",children:Object(h.jsx)("svg",{xmlns:"http://www.w3.org/2000/svg",className:"h-6 w-6",fill:"none",viewBox:"0 0 24 24",stroke:"currentColor",children:Object(h.jsx)("path",{strokeLinecap:"round",strokeLinejoin:"round",strokeWidth:"2",d:"M7 11.5V14m0-2.5v-6a1.5 1.5 0 113 0m-3 6a1.5 1.5 0 00-3 0v2a7.5 7.5 0 0015 0v-5a1.5 1.5 0 00-3 0m-6-3V11m0-5.5v-1a1.5 1.5 0 013 0v1m0 0V11m0-5.5a1.5 1.5 0 013 0v3m0 0V11"})})})]}),Object(h.jsxs)("h1",{className:"block my-1 pr-2 text-xl font-semibold",children:["overview"===n?Object(h.jsx)(u.a,{id:"app.learningDashboard.participantsTable.title",defaultMessage:"Overview"}):null,"polling"===n?Object(h.jsx)(u.a,{id:"app.learningDashboard.pollsTable.title",defaultMessage:"Polling"}):null]}),Object(h.jsx)("div",{className:"w-full overflow-hidden rounded-md shadow-xs border-2 border-gray-100",children:Object(h.jsxs)("div",{className:"w-full overflow-x-auto",children:["overview"===n?Object(h.jsx)(O,{allUsers:a.users,totalOfActivityTime:i()}):null,"polling"===n?Object(h.jsx)(f,{polls:a.polls,allUsers:a.users}):null]})})]})}}]),s}(c.a.Component),w=Object(m.c)(v),N=function(e){e&&e instanceof Function&&s.e(3).then(s.bind(null,41)).then((function(t){var s=t.getCLS,a=t.getFID,n=t.getFCP,r=t.getLCP,i=t.getTTFB;s(e),a(e),n(e),r(e),i(e)}))},y=function(e){Object(r.a)(s,e);var t=Object(i.a)(s);function s(e){var n;return Object(a.a)(this,s),(n=t.call(this,e)).state={intlMessages:{},intlLocale:"en"},n.setMessages(),n}return Object(n.a)(s,[{key:"setMessages",value:function(){var e=this,t=navigator.language,s=new URLSearchParams(window.location.search),a=Object.fromEntries(s.entries());"undefined"!==typeof a.lang&&(t=a.lang);var n=function(e){return new Promise((function(t,s){var a="/html5client/locales/".concat(e.replace("-","_"),".json");fetch(a).then((function(e){return e.ok?t(e.json()):s()}))}))};Promise.all([n("en"),n(t)]).then((function(s){var a={};s[0]&&(a=Object.assign(a,s[0])),s[1]&&(a=Object.assign(a,s[1])),e.setState({intlMessages:a,intlLocale:t})})).catch((function(){}))}},{key:"render",value:function(){var e=this.state,t=e.intlLocale,s=e.intlMessages;return Object(h.jsx)(j.a,{defaultLocale:"en",locale:t,messages:s,children:Object(h.jsx)(w,{})})}}]),s}(c.a.Component),k=document.getElementById("root");d.a.render(Object(h.jsx)(y,{}),k),N()}},[[38,1,2]]]);
//# sourceMappingURL=main.8f1acbe1.chunk.js.map