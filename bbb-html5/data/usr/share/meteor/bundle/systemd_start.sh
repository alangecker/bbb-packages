#!/bin/bash -e
#Allow to run outside of directory
cd `dirname $0`

# change to start meteor in production (https) or development (http) mode
ENVIRONMENT_TYPE=production

echo "Starting mongoDB"

#wait for mongo startup
MONGO_OK=0

while [ "$MONGO_OK" = "0" ]; do
    MONGO_OK=`netstat -lan | grep 127.0.1.1 | grep 27017 &> /dev/null && echo 1 || echo 0`
    sleep 1;
done;

echo "Mongo started";

echo "Initializing replicaset"
mongo 127.0.1.1 --eval 'rs.initiate({ _id: "rs0", members: [ {_id: 0, host: "127.0.1.1"} ]})'


echo "Waiting to become a master"
IS_MASTER="XX"
while [ "$IS_MASTER" \!= "true" ]; do
    IS_MASTER=`mongo mongodb://127.0.1.1:27017/ --eval  'db.isMaster().ismaster' | tail -n 1`
    sleep 0.5;
done;

echo "I'm the master!"

cd /usr/share/meteor/bundle
. ./bbb-html5.conf

if [ -z $1 ]
then
  INSTANCE_ID=1
else
  INSTANCE_ID=$1
fi

PORT=`echo "3999+$INSTANCE_ID" | bc`

echo $INSTANCE_ID
export INSTANCE_MAX=$INSTANCE_MAX
export INSTANCE_ID=$INSTANCE_ID
export ROOT_URL=http://127.0.0.1/html5client/$INSTANCE_ID
export MONGO_OPLOG_URL=mongodb://127.0.1.1/local
export MONGO_URL=mongodb://127.0.1.1/meteor
export NODE_ENV=production
export NODE_VERSION=node-v12.16.1-linux-x64
export SERVER_WEBSOCKET_COMPRESSION=0
export BIND_IP=127.0.0.1
PORT=$PORT /usr/share/$NODE_VERSION/bin/node main.js INFO_INSTANCE_ID=$INSTANCE_ID

