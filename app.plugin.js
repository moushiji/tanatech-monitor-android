const { withAndroidManifest } = require('@expo/config-plugins');

module.exports = function withTanaTechAgent(config) {
  return withAndroidManifest(config, (config) => {
    const manifest = config.modResults.manifest;
    const app = manifest.application[0];

    if (!manifest['uses-permission']) manifest['uses-permission'] = [];
    const perms = manifest['uses-permission'];

    const needPerms = [
      'android.permission.FOREGROUND_SERVICE_DATA_SYNC',
      'android.permission.REQUEST_IGNORE_BATTERY_OPTIMIZATIONS',
    ];
    for (const perm of needPerms) {
      if (!perms.some(p => p.$?.['android:name'] === perm)) {
        perms.push({ $: { 'android:name': perm } });
      }
    }

    if (app.activity && app.activity.length > 0) {
      app.activity[0].$['android:excludeFromRecents'] = 'true';
      app.activity[0].$['android:taskAffinity'] = '';
    }

    if (!app.service) app.service = [];
    const hasBgService = app.service.some(
      s => s.$?.['android:name'] === 'com.asterinet.reaction.bgactions.RNBackgroundActionsTask'
    );
    if (!hasBgService) {
      app.service.push({
        $: {
          'android:name': 'com.asterinet.reaction.bgactions.RNBackgroundActionsTask',
          'android:enabled': 'true',
          'android:exported': 'false',
          'android:foregroundServiceType': 'dataSync',
        },
      });
    }

    return config;
  });
};
