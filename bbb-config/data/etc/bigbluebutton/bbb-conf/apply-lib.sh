#!/bin/bash -e

# This is a library of functions for apply-config.sh, which, if created, will be automatically called by
# bbb-conf when you run
#
#   bbb-conf --restart
#   bbb-conf --seitp ...
#
# The purpose of apply-config.sh is to make it easy to apply your configuration changes to a BigBlueButton server 
# before BigBlueButton starts
#


if LANG=c ifconfig | grep -q 'venet0:0'; then
  # IP detection for OpenVZ environment
  IP=$(ifconfig | grep -v '127.0.0.1' | grep -E "[0-9]*\.[0-9]*\.[0-9]*\.[0-9]*" | tail -1 | cut -d: -f2 | awk '{ print $1}')
else
  IP=$(hostname -I | sed 's/ .*//g')
fi

if [ -f /usr/share/bbb-web/WEB-INF/classes/bigbluebutton.properties ]; then
  SERVLET_DIR=/usr/share/bbb-web
else
  SERVLET_DIR=/var/lib/tomcat7/webapps/bigbluebutton
fi

PROTOCOL=http
if [ -f $SERVLET_DIR/WEB-INF/classes/bigbluebutton.properties ]; then
  SERVER_URL=$(cat $SERVLET_DIR/WEB-INF/classes/bigbluebutton.properties | sed -n '/^bigbluebutton.web.serverURL/{s/.*\///;p}')
  if cat $SERVLET_DIR/WEB-INF/classes/bigbluebutton.properties | grep bigbluebutton.web.serverURL | grep -q https; then
    PROTOCOL=https
  fi
fi

HOST=$(cat $SERVLET_DIR/WEB-INF/classes/bigbluebutton.properties | grep -v '#' | sed -n '/^bigbluebutton.web.serverURL/{s/.*\///;p}')
HTML5_CONFIG=/usr/share/meteor/bundle/programs/server/assets/app/config/settings.yml


#
# Enable Looging of the HTML5 client for debugging
#
enableHTML5ClientLog() {
  echo "  - Enable HTML5 client log to /var/log/nginx/html5-client.log"

  yq w -i $HTML5_CONFIG public.clientLog.external.enabled true
  yq w -i $HTML5_CONFIG public.clientLog.external.url     "$PROTOCOL://$HOST/html5log"
  yq w -i $HTML5_CONFIG public.app.askForFeedbackOnLogout true
  chown meteor:meteor $HTML5_CONFIG

  cat > /etc/bigbluebutton/nginx/html5-client-log.nginx << HERE
location /html5log {
        access_log /var/log/nginx/html5-client.log postdata;
        echo_read_request_body;
}
HERE

  cat > /etc/nginx/conf.d/html5-client-log.conf << HERE
log_format postdata '\$remote_addr [\$time_iso8601] \$request_body';
HERE

  # We need nginx-full to enable postdata log_format
  if ! dpkg -l | grep -q nginx-full; then
    apt-get install -y nginx-full
  fi

  touch /var/log/nginx/html5-client.log
  chown bigbluebutton:bigbluebutton /var/log/nginx/html5-client.log

  #
  # You can monitor the live HTML5 client logs with the command
  #
  #   tail -f /var/log/nginx/html5-client.log | sed -u 's/\\x22/"/g' | sed -u 's/\\x5C//g'
}

#
# Enable HTML5 as default
#
setHTML5ClientAsDefault() {
  echo "  - Make HTML5 the default client in /usr/share/bbb-web/WEB-INF/classes/bigbluebutton.properties"

  sed -i 's/^attendeesJoinViaHTML5Client=.*/attendeesJoinViaHTML5Client=true/'   /usr/share/bbb-web/WEB-INF/classes/bigbluebutton.properties
  sed -i 's/^moderatorsJoinViaHTML5Client=.*/moderatorsJoinViaHTML5Client=true/' /usr/share/bbb-web/WEB-INF/classes/bigbluebutton.properties
}


enableHTML5CameraQualityThresholds() {
  echo "  - Enable HTML5 cameraQualityThresholds"
  yq w -i $HTML5_CONFIG public.kurento.cameraQualityThresholds.enabled true
}

enableHTML5WebcamPagination() {
  echo "  - Enable HTML5 webcam pagination"
  yq w -i $HTML5_CONFIG public.kurento.pagination.enabled true
}


#
# Enable firewall rules to open only 
#
enableUFWRules() {
  echo "  - Enable Firewall and opening 22/tcp, 80/tcp, 443/tcp and 16384:32768/udp"

  if ! which ufw > /dev/null; then
    apt-get install -y ufw
  fi

  #  Add 1935 if Flash client is enabled
  if [[ "$(cat $SERVLET_DIR/WEB-INF/classes/bigbluebutton.properties | sed -n '/^attendeesJoinViaHTML5Client/{s/.*=//;p}')" == "true" &&
        "$(cat $SERVLET_DIR/WEB-INF/classes/bigbluebutton.properties | sed -n '/^moderatorsJoinViaHTML5Client/{s/.*=//;p}')" == "true" ]]; then
    ufw deny 1935/tcp
  else
    ufw allow 1935/tcp
  fi
  ufw allow OpenSSH
  ufw allow "Nginx Full"
  ufw allow 16384:32768/udp
  ufw --force enable
}


enableMultipleKurentos() {
  echo "  - Configuring three Kurento Media Servers: one for listen only, webcam, and screeshare"

  # Step 1.  Setup shared certificate between FreeSWITCH and Kurento

  HOSTNAME=$(cat /etc/nginx/sites-available/bigbluebutton | grep -v '#' | sed -n '/server_name/{s/.*server_name[ ]*//;s/;//;p}' | cut -d' ' -f1 | head -n 1)
  openssl req -x509 -new -nodes -newkey rsa:2048 -sha256 -days 3650 -subj "/C=BR/ST=Ottawa/O=BigBlueButton Inc./OU=Live/CN=$HOSTNAME" -keyout /tmp/dtls-srtp-key.pem -out /tmp/dtls-srtp-cert.pem
  cat /tmp/dtls-srtp-key.pem /tmp/dtls-srtp-cert.pem > /etc/kurento/dtls-srtp.pem
  cat /tmp/dtls-srtp-key.pem /tmp/dtls-srtp-cert.pem > /opt/freeswitch/etc/freeswitch/tls/dtls-srtp.pem

  sed -i 's/;pemCertificateRSA=.*/pemCertificateRSA=\/etc\/kurento\/dtls-srtp.pem/g' /etc/kurento/modules/kurento/WebRtcEndpoint.conf.ini

  # Step 2.  Setup systemd unit files to launch three separate instances of Kurento

  for i in `seq 8888 8890`; do

    cat > /usr/lib/systemd/system/kurento-media-server-${i}.service << HERE
  # /usr/lib/systemd/system/kurento-media-server-#{i}.service
  [Unit]
  Description=Kurento Media Server daemon (${i})
  After=network.target
  PartOf=kurento-media-server.service
  After=kurento-media-server.service

  [Service]
  UMask=0002
  Environment=KURENTO_LOGS_PATH=/var/log/kurento-media-server
  Environment=KURENTO_CONF_FILE=/etc/kurento/kurento-${i}.conf.json
  User=kurento
  Group=kurento
  LimitNOFILE=1000000
  ExecStartPre=-/bin/rm -f /var/kurento/.cache/gstreamer-1.5/registry.x86_64.bin
  ExecStart=/usr/bin/kurento-media-server --gst-debug-level=3 --gst-debug="3,Kurento*:4,kms*:4,KurentoWebSocketTransport:5"
  Type=simple
  PIDFile=/var/run/kurento-media-server-${i}.pid
  Restart=always

  [Install]
  WantedBy=kurento-media-server.service

HERE

    # Make a new configuration file each instance of Kurento that binds to a different port
    cp /etc/kurento/kurento.conf.json /etc/kurento/kurento-${i}.conf.json
    sed -i "s/8888/${i}/g" /etc/kurento/kurento-${i}.conf.json

  done

  # Step 3. Override the main kurento-media-server unit to start/stop the three Kurento instances

  cat > /etc/systemd/system/kurento-media-server.service << HERE
  [Unit]
  Description=Kurento Media Server

  [Service]
  Type=oneshot
  ExecStart=/bin/true
  RemainAfterExit=yes

  [Install]
  WantedBy=multi-user.target
HERE

  systemctl daemon-reload

  for i in `seq 8888 8890`; do
    systemctl enable kurento-media-server-${i}.service
  done


  # Step 4.  Modify bbb-webrtc-sfu config to use the three Kurento servers

  KURENTO_CONFIG=/usr/local/bigbluebutton/bbb-webrtc-sfu/config/default.yml

  MEDIA_TYPE=(main audio content)
  IP=$(yq r /usr/local/bigbluebutton/bbb-webrtc-sfu/config/default.yml kurento[0].ip)

  for i in `seq 0 2`; do
    yq w -i $KURENTO_CONFIG "kurento[$i].ip" $IP
    yq w -i $KURENTO_CONFIG "kurento[$i].url" "ws://127.0.0.1:$(($i + 8888))/kurento"
    yq w -i $KURENTO_CONFIG "kurento[$i].mediaType" "${MEDIA_TYPE[$i]}"
    yq w -i $KURENTO_CONFIG "kurento[$i].ipClassMappings.local" ""
    yq w -i $KURENTO_CONFIG "kurento[$i].ipClassMappings.private" ""
    yq w -i $KURENTO_CONFIG "kurento[$i].ipClassMappings.public" ""
    yq w -i $KURENTO_CONFIG "kurento[$i].options.failAfter" 5
    yq w -i $KURENTO_CONFIG "kurento[$i].options.request_timeout" 30000
    yq w -i $KURENTO_CONFIG "kurento[$i].options.response_timeout" 30000
  done

  yq w -i $KURENTO_CONFIG balancing-strategy MEDIA_TYPE
}

disableMultipleKurentos() {
  echo "  - Configuring a single Kurento Media Server for listen only, webcam, and screeshare"
  systemctl stop kurento-media-server.service

  for i in `seq 8888 8890`; do
    systemctl disable kurento-media-server-${i}.service
  done

  # Remove the overrride (restoring the original kurento-media-server.service unit file)
  rm -f /etc/systemd/system/kurento-media-server.service
  systemctl daemon-reload

  # Restore bbb-webrtc-sfu configuration to use a single instance of Kurento
  KURENTO_CONFIG=/usr/local/bigbluebutton/bbb-webrtc-sfu/config/default.yml
  yq d -i $KURENTO_CONFIG kurento[1]
  yq d -i $KURENTO_CONFIG kurento[1]

  yq w -i $KURENTO_CONFIG "kurento[0].url" "ws://127.0.0.1:8888/kurento"
  yq w -i $KURENTO_CONFIG "kurento[0].mediaType" ""

  yq w -i $KURENTO_CONFIG balancing-strategy ROUND_ROBIN
}



notCalled() {
#
# This function is not called.

# Instead, it gives you the ability to copy the following text and paste it into the shell to create a starting point for
# apply-config.sh.
#
# By creating apply-config.sh manually, it will not be overwritten by any package updates.  You can call functions in this
# library for commong BigBlueButton configuration tasks.

## Start Copying HEre
  cat > /etc/bigbluebutton/bbb-conf/apply-config.sh << HERE
#!/bin/bash

# Pull in the helper functions for configuring BigBlueButton
source /etc/bigbluebutton/bbb-conf/apply-lib.sh

# Available configuration options

#enableHTML5ClientLog
#setHTML5ClientAsDefault
#enableUFWRules

#enableHTML5CameraQualityThresholds
#enableHTML5WebcamPagination

HERE
chmod +x /etc/bigbluebutton/bbb-conf/apply-config.sh
## Stop Copying HERE
}

