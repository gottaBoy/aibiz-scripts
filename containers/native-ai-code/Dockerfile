ARG NGINX_IMAGE=nginxinc/nginx-unprivileged:alpine
FROM ${NGINX_IMAGE}

USER root
RUN rm -rf /srv/plugins
COPY nginx.conf /etc/nginx/nginx.conf
COPY --chown=101:101 plugins/ /srv/plugins/
RUN find /srv/plugins -type d -exec chmod 0755 {} + \
    && find /srv/plugins -type f -exec chmod 0644 {} + \
    && chmod 0644 /etc/nginx/nginx.conf

USER 101:101
EXPOSE 8080
HEALTHCHECK --interval=5s --timeout=3s --retries=3 \
  CMD ["wget", "-q", "-O", "/dev/null", "http://127.0.0.1:8080/health"]
ENTRYPOINT ["nginx"]
CMD ["-g", "daemon off;"]
