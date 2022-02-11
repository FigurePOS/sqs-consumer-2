#!/bin/sh
# Usage: wait_cmd timeout check
wait_cmd() {
  for i in `seq $1` ; do
    sh -c "$2"
    result=$?
    if [ $result -eq 0 ] ; then
      exit 0
    fi
    sleep 1
  done
  echo "Operation timed out" >&2
  exit 1
}

# Usage: wait_host_port timeout host port
wait_host_port() {
  wait_cmd $1 "nc -z $2 $3 > /dev/null 2>&1"
}

WHAT=$1;
shift 1;

echo "wait $1s for $WHAT: $2 $3 $4 $5"
wait_$WHAT "$@";