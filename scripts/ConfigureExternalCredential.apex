/**
 * Configure External Credential for CI environment
 *
 * Template file for setting AAD Client ID and Client Secret on External Credential.
 * Placeholders {{CLIENT_ID}} and {{CLIENT_SECRET}} must be replaced via shell substitution.
 *
 * Usage:
 *   sed -e "s|{{CLIENT_ID}}|$AAD_CLIENT_ID|g" \
 *       -e "s|{{CLIENT_SECRET}}|$AAD_CLIENT_SECRET|g" \
 *       scripts/ConfigureExternalCredential.apex > /tmp/configure-cred.apex
 *   sf apex run --file /tmp/configure-cred.apex
 */

// TEMPLATE PLACEHOLDERS - Replace via shell string substitution
String clientId = '{{CLIENT_ID}}';
String clientSecret = '{{CLIENT_SECRET}}';

try {
    ConnectApi.CredentialInput credentialInput = new ConnectApi.CredentialInput();

    credentialInput.externalCredential = 'Docgen_AAD_Credential_CI';
    credentialInput.principalType = ConnectApi.CredentialPrincipalType.NamedPrincipal;
    credentialInput.principalName = 'CI';

    Map<String, ConnectApi.CredentialValueInput> credentials = new Map<String, ConnectApi.CredentialValueInput>();

    ConnectApi.CredentialValueInput clientIdInput = new ConnectApi.CredentialValueInput();
    clientIdInput.value = clientId;
    clientIdInput.encrypted = false;
    credentials.put('clientId', clientIdInput);

    ConnectApi.CredentialValueInput clientSecretInput = new ConnectApi.CredentialValueInput();
    clientSecretInput.value = clientSecret;
    clientSecretInput.encrypted = true;
    credentials.put('clientSecret', clientSecretInput);

    credentialInput.credentials = credentials;

    System.debug(LoggingLevel.INFO, 'Configuring External Credential: Docgen_AAD_Credential_CI');
    System.debug(LoggingLevel.INFO, 'Principal: CI');
    System.debug(LoggingLevel.INFO, 'Client ID: ' + clientId.substring(0, 8) + '...');

    ConnectApi.CredentialAuthenticationStatus principalStatus = getExistingPrincipalAuthenticationStatus('Docgen_AAD_Credential_CI', 'CI');

    if (principalStatus == ConnectApi.CredentialAuthenticationStatus.Configured) {
        System.debug(LoggingLevel.INFO, 'Principal exists and is configured - updating credentials');
        ConnectApi.NamedCredentials.updateCredential(credentialInput);
    } else {
        System.debug(LoggingLevel.INFO, 'Principal does not exist or not configured - creating credentials');
        ConnectApi.NamedCredentials.createCredential(credentialInput);
    }

    System.debug(LoggingLevel.INFO, '✅ External Credential configured successfully');
    System.debug(LoggingLevel.INFO, '✅ Principal "CI" now has ClientId and ClientSecret set');

} catch (Exception e) {
    System.debug(LoggingLevel.ERROR, '❌ Failed to configure External Credential: ' + e.getMessage());
    System.debug(LoggingLevel.ERROR, 'Stack trace: ' + e.getStackTraceString());
    throw e;
}

ConnectApi.CredentialAuthenticationStatus getExistingPrincipalAuthenticationStatus(String externalCredentialName, String principalName) {
    try {
        ConnectApi.ExternalCredential existingCredential = ConnectApi.NamedCredentials.getExternalCredential(externalCredentialName);

        if (existingCredential != null && existingCredential.principals != null) {
            for (Integer i = 0; i < existingCredential.principals.size(); i++) {
                ConnectApi.ExternalCredentialPrincipal thisPrincipal = existingCredential.principals[i];
                if (thisPrincipal.principalName == principalName) {
                    return thisPrincipal.authenticationStatus;
                }
            }
        }
    } catch (Exception e) {
        System.debug(LoggingLevel.WARN, 'Could not retrieve existing credential: ' + e.getMessage());
    }

    return null;
}
