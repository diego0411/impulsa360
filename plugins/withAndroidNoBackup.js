const fs = require('fs');
const path = require('path');
const { AndroidConfig, withAndroidManifest, withDangerousMod } = require('@expo/config-plugins');

const BACKUP_RULES_XML = `<?xml version="1.0" encoding="utf-8"?>
<full-backup-content>
  <exclude domain="database" path="RKStorage" />
  <exclude domain="database" path="RKStorage-journal" />
  <exclude domain="sharedpref" path="*" />
  <exclude domain="file" path="activaciones-pendientes/" />
</full-backup-content>
`;

const DATA_EXTRACTION_RULES_XML = `<?xml version="1.0" encoding="utf-8"?>
<data-extraction-rules>
  <cloud-backup>
    <exclude domain="database" path="RKStorage" />
    <exclude domain="database" path="RKStorage-journal" />
    <exclude domain="sharedpref" path="*" />
    <exclude domain="file" path="activaciones-pendientes/" />
  </cloud-backup>
  <device-transfer>
    <exclude domain="database" path="RKStorage" />
    <exclude domain="database" path="RKStorage-journal" />
    <exclude domain="sharedpref" path="*" />
    <exclude domain="file" path="activaciones-pendientes/" />
  </device-transfer>
</data-extraction-rules>
`;

const ensureXmlResource = (projectRoot, name, contents) => {
  const xmlDir = path.join(projectRoot, 'android', 'app', 'src', 'main', 'res', 'xml');
  fs.mkdirSync(xmlDir, { recursive: true });
  fs.writeFileSync(path.join(xmlDir, `${name}.xml`), contents);
};

module.exports = function withAndroidNoBackup(config) {
  config = withAndroidManifest(config, (manifestConfig) => {
    const application = AndroidConfig.Manifest.getMainApplicationOrThrow(manifestConfig.modResults);
    application.$['android:allowBackup'] = 'false';
    application.$['android:fullBackupContent'] = '@xml/backup_rules';
    application.$['android:dataExtractionRules'] = '@xml/data_extraction_rules';
    return manifestConfig;
  });

  return withDangerousMod(config, ['android', async (modConfig) => {
    ensureXmlResource(modConfig.modRequest.projectRoot, 'backup_rules', BACKUP_RULES_XML);
    ensureXmlResource(modConfig.modRequest.projectRoot, 'data_extraction_rules', DATA_EXTRACTION_RULES_XML);
    return modConfig;
  }]);
};
