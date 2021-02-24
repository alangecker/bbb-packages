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

NODE_VERSION=node-v8.17.0-linux-x64

cd /usr/share/meteor/bundle
export ROOT_URL=http://127.0.0.1/html5client
export MONGO_OPLOG_URL=mongodb://127.0.1.1/local
export MONGO_URL=mongodb://127.0.1.1/meteor
export NODE_ENV=$ENVIRONMENT_TYPE
export SERVER_WEBSOCKET_COMPRESSION=0
export BIND_IP=127.0.0.1
PORT=3000 /usr/share/$NODE_VERSION/bin/node --max-old-space-size=4096 --max_semi_space_size=128  main.js

