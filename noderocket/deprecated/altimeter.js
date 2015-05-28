var Cylon = require('cylon');
var events = require('events');
var _ = require('underscore');

function Altimeter(opts) {
    this.config = _.extend({
        dataInterval: 100,
        mode: 1,
        servoInitAngle: 150,
        servoReleaseAngle: 65,
        armAltDelta: 8,
        deployAltDelta: 2,
        autoResetDelay: 30000
    }, opts);

  events.EventEmitter.call(this);
  var thiz = this;
  var activated = false;
  var armed = false;
  var deployed = false;
  var initialAltitude = null;
  var maxAltitude = null;
  var lastAltitude;

  Cylon.robot({
    connection: {name: 'raspi', adaptor: 'raspi'},
    devices: [
      { name: 'bmp180',   driver: 'bmp180' },
      { name: 'servo',    driver: 'servo',  pin: 12 },
      { name: 'statusLed', driver: 'led',    pin: 15 }
    ],

    work: function (my) {
      Logger.debug(thiz.config);
      Logger.debug('Setting angle to ' + thiz.config.servoInitAngle);

      my.servo.angle(thiz.config.servoInitAngle);

      my.statusLed.turnOn();

      var armAltDelta = thiz.config.armAltDelta;
      var deployAltDelta = thiz.config.deployAltDelta;

      thiz.on('init', function () {
        Logger.debug('Initializing angle to ' + thiz.config.servoInitAngle);
        my.servo.angle(thiz.config.servoInitAngle);
        activated = false;
        armed = false;
        deployed = false;
        initialAltitude = altRollingAvg;
        Logger.debug('Zeroed altitude at ' + initialAltitude);
        maxAltitude = 0;

        thiz.emit('reset', initialAltitude);
      });

      thiz.on('armed', function() {
        Logger.debug('[[ARMED]]: at altitude: ' + maxAltitude + ' up: ' + (maxAltitude - initialAltitude));
      });

      thiz.on('parachute', function () {
        Logger.debug('[[[PARACHUTE]]]: set angle to ' + thiz.config.servoReleaseAngle);
        my.servo.angle(thiz.config.servoReleaseAngle);
        thiz.emit('parachuteDeployed', lastAltitude);

        setTimeout(
          function() {
            thiz.emit('init', initialAltitude);
          },
          thiz.config.autoResetDelay
        );
      });

      thiz.on('activate', function () {
        Logger.debug('Activated');
        activated = true;
      });

      // This doesn't really do anything except notify clients that this has been done;
      thiz.emit('init', initialAltitude);

      every(thiz.config.dataInterval, function () {
        my.bmp180.getAltitude(thiz.config.mode, null, function (err, values) {
          if (!!err) Logger.error(err);
          else {
            var alt = normalizeValue(values.alt);
            lastAltitude = alt;
            thiz.emit('data', alt);

            if (activated) {
              if (alt > maxAltitude) {
                Logger.debug('New Max Altitude: ' + alt + ' up: ' + (alt - initialAltitude));
                maxAltitude = alt;
                thiz.emit('gotMaxAltitude', alt);
              }

              if (armed === false && (alt - initialAltitude >= armAltDelta)) {
                armed = true;
                thiz.emit('armed', alt);
              }
              else if (armed === true && deployed !== true) {
                if (alt > maxAltitude) {
                  maxAltitude = alt;
                  Logger.debug('New Max Altitude: ' + alt + ' up: ' + (alt - initialAltitude));
                  thiz.emit('maxAltitude', {alt: maxAltitude});
                }
                else if (maxAltitude - alt >= deployAltDelta) {
                  Logger.debug('Losing Altitude: ' + alt + ' down: ' + (maxAltitude - alt));
                  thiz.emit('parachute', alt);
                  deployed = true;
                }
              }
            }
          }
        });
      });
    }
  }).start();

  this.setServoInitAngle = function (angle) {
    this.config.servoInitAngle = angle;
  };

  this.setServoReleaseAngle = function (angle) {
    this.config.servoReleaseAngle = angle;
  };

  // --- Utility Functions -----------------------------------------------------

  /**
   * 111.76 is the equivalent of 250 MPH in Meters Per Second
   * 250 Miles == 402336 Meters
   * 402336 / 60 (min in hr) = 6705.6
   * 6705.6 / 60 (sec in min) = 111.76
   *
   * @type {number}
   */
  var MAX_REALISTIC_SPEED = 111.76 / (1000 / this.config.dataInterval);

  var cnt = 0;
  var bufferLength = 5;
  var altitudeBuffer = [];
  var velocityBuffer = [];
  var altRollingAvg = 0;
  var velRollingAvg = 0;
  var last;

  function normalizeValue(current) {
//    Logger.debug('Initializing Altitude Normalization Values');
    for (var i = 0; i < bufferLength; ++i) {
      altitudeBuffer[i] = current;
      velocityBuffer[i] = 0;
    }
    last = current;
    altRollingAvg = current;
    velRollingAvg = 0;

    normalizeValue = normalizeValueFn;
    var alt = normalizeValue(current);

    initialAltitude = alt;
    thiz.emit('init', alt);
    Logger.debug('Zeroed altitude at ' + initialAltitude);

    return alt;
  }

  function normalizeValueFn(current) {
//    Logger.debug('Normalizing Value: ' + current);
    var metersSinceLast = current.alt - last;
    if (metersSinceLast > MAX_REALISTIC_SPEED) {
      Logger.debug('Current alt: ' + current.alt);
      Logger.debug('Last alt: ' + last);
      var mph = (metersSinceLast * 0.000621371) * (1000 / thiz.config.dataInterval) * 60 * 60;
      Logger.debug('mph: ' + mph);
      Logger.debug('Altimeter value of ' + current.alt + ' is a change of ' + metersSinceLast + '.' +
        '  That is ' + mph + 'mph!' +
        '  Substituting ' + (last + velRollingAvg));
      current = last + velRollingAvg;
    }

    var index = cnt++ % bufferLength;
    altitudeBuffer[index] = current;
    velocityBuffer[index] = current - last;
    getAverages();

    last = current;
    return altRollingAvg;
  }

  function getAverages() {
    var aSum = 0;
    var vSum = 0;
    for (var i = 0; i < bufferLength; ++i) {
      aSum += altitudeBuffer[i];
      vSum += velocityBuffer[i];
    }

    altRollingAvg = aSum / bufferLength;
    velRollingAvg = vSum / bufferLength;
  }
}

Altimeter.prototype.__proto__ = events.EventEmitter.prototype;

module.exports = Altimeter;
