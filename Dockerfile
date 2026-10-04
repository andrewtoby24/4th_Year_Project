FROM php:8.3-apache

RUN docker-php-ext-install pdo_mysql \
    && a2enmod headers

ENV APACHE_DOCUMENT_ROOT=/var/www/html/public
RUN sed -ri "s!/var/www/html!${APACHE_DOCUMENT_ROOT}!g" /etc/apache2/sites-available/*.conf \
    && sed -ri "s!/var/www/!${APACHE_DOCUMENT_ROOT}/!g" /etc/apache2/apache2.conf /etc/apache2/conf-available/*.conf

COPY app /var/www/html/app
COPY config /var/www/html/config
COPY public /var/www/html/public

EXPOSE 80
