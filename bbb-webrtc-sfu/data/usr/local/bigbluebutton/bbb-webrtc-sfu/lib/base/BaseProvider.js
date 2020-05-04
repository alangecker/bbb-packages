"use strict";

const C = require('../bbb/messages/Constants');
const Messaging = require('../bbb/messages/Messaging');
const Logger = require('../utils/Logger');
const EventEmitter = require('events').EventEmitter;
const errors = require('../base/errors');
const config = require('config');

module.exports = class BaseProvider extends EventEmitter {
  constructor (bbbGW) {
    super();
    this.sfuApp = "base";
    this.bbbGW = bbbGW;
  }

  _handleError (logPrefix, error, role, streamId) {
    Logger.trace(logPrefix, error);

    // Setting a default error in case it was unhandled
    if (error == null) {
      error = { code: 2200, reason: errors[2200] }
    }

    if (this._validateErrorMessage(error)) {
      return error;
    }

    const { code } = error;
    const reason = errors[code];

    if (reason == null) {
      return;
    }

    error.message = reason;

    Logger.debug(logPrefix, "Handling error", error.code, error.message);

    return this._assembleErrorMessage(error, role, streamId);
  }

  _assembleErrorMessage (error, role, streamId) {
    return {
      type: this.sfuApp,
      id: 'error',
      role,
      streamId,
      code: error.code,
      reason: error.message,
    };
  }

  _validateErrorMessage (error) {
    const {
      type = null,
      id = null,
      role = null,
      streamId = null,
      code = null,
      reason = null,
    } = error;
    return type && id && role && streamId && code && reason;
  }

  _assembleStreamName (direction, bbbUserId, bbbMeetingId) {
    return `bigbluebutton|${direction}|${this.sfuApp}|${bbbUserId}|${bbbMeetingId}`;
  }

  sendGetRecordingStatusRequestMessage(meetingId, userId) {
    let req = Messaging.generateRecordingStatusRequestMessage(meetingId, userId);

    this.bbbGW.publish(req, C.TO_AKKA_APPS);
  }

  probeForRecordingStatus (meetingId, userId) {
    return new Promise((resolve, reject) => {
      const onRecordingStatusReply = (payload) => {
        if (payload.requestedBy === userId) {
          Logger.info("RecordingStatusReply for userId", payload.requestedBy, "is", payload.recorded);
          this.bbbGW.removeListener(C.RECORDING_STATUS_REPLY_MESSAGE_2x+meetingId, onRecordingStatusReply)
          return resolve(payload.recorded);
        }
      };

      this.bbbGW.on(C.RECORDING_STATUS_REPLY_MESSAGE_2x+meetingId, onRecordingStatusReply)

      this.sendGetRecordingStatusRequestMessage(meetingId, userId);
    });
  }

  flushCandidatesQueue (broker, queue, mediaId = null) {
    if (mediaId) {
      Logger.trace("Flushing", queue.length, "candidates queue for", mediaId);
      queue.forEach(async (candidate) => {
        try {
          await broker.addIceCandidate(mediaId, candidate);
        } catch (e) {
          Logger.error("ICE candidate for media", mediaId, "could not be added to media controller.", e);
        }
      });
    }
  }


  getRecordingPath (room, subPath, recordingName, format) {
    const basePath = config.get('recordingBasePath');
    const timestamp = (new Date()).getTime();

    return `${basePath}/${subPath}/${room}/${recordingName}-${timestamp}.${format}`
  }

  handleMCSCoreDisconnection (error) {
    Logger.error(`[${this.sfuApp}] Provider received a MCS core disconnection event, fire a MEDIA_SERVER_OFFLINE`);
    this.emit(C.MEDIA_SERVER_OFFLINE);
  }
};
