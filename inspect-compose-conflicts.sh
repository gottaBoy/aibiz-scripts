#!/usr/bin/env bash

set -u

containers=(
  ibiz-ebsx-allinone
  plmservice
  ibizlab-uaa-api
  ibiz-ebsx-gateway
  modelingservice
  modelingweb
  modeling-plugins
)

for container in "${containers[@]}"; do
  if ! docker inspect "$container" >/dev/null 2>&1; then
    printf '%s: absent\n' "$container"
    continue
  fi

  docker inspect "$container" --format \
    'container={{.Name}} status={{.State.Status}} running={{.State.Running}} image={{.Config.Image}} project={{index .Config.Labels "com.docker.compose.project"}} service={{index .Config.Labels "com.docker.compose.service"}} config={{index .Config.Labels "com.docker.compose.project.config_files"}} networks={{range $name, $_ := .NetworkSettings.Networks}}{{$name}} {{end}}'
done
