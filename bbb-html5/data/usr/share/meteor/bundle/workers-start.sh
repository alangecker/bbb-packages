#!/bin/bash
# Start parallel nodejs processes for bbb-html5. Number varies on restrictions file

source /usr/share/meteor/bundle/bbb-html5.conf

NEW_INSTANCE_COUNT=1 # default safe value


if [ $DESIRED_INSTANCE_COUNT -le $INSTANCE_MAX ]; then
  if [ $DESIRED_INSTANCE_COUNT -ge $INSTANCE_MIN ]; then
    NEW_INSTANCE_COUNT=$DESIRED_INSTANCE_COUNT
  else
    NEW_INSTANCE_COUNT=$INSTANCE_MIN
  fi
else
  NEW_INSTANCE_COUNT=$INSTANCE_MAX
fi

for ((i = 1 ; i <= $NEW_INSTANCE_COUNT ; i++)); do
  systemctl start bbb-html5-worker@$i
done

