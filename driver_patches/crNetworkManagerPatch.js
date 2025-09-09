import { Project, SyntaxKind } from "ts-morph";

// ----------------------------
// server/chromium/crNetworkManager.ts
// ----------------------------
export function patchCRNetworkManager(project) {
    // Add source file to the project
    const crNetworkManagerSourceFile = project.addSourceFileAtPath("packages/playwright-core/src/server/chromium/crNetworkManager.ts");
    // Add the custom import and comment at the start of the file
    crNetworkManagerSourceFile.insertStatements(0, [
      "// patchright - custom imports",
      "import crypto from 'crypto';",
      "",
    ]);

    // ------- CRNetworkManager Class -------
    const crNetworkManagerClass = crNetworkManagerSourceFile.getClass("CRNetworkManager");
    crNetworkManagerClass.addProperties([
      {
        name: "_alreadyTrackedNetworkIds",
        type: "Set<string>",
        initializer: "new Set()",
      },
    ]);

    // -- _onRequest Method --
    const onRequestMethod = crNetworkManagerClass.getMethod("_onRequest");
    // Find the assignment statement you want to modify
    const routeAssignment = onRequestMethod
      .getDescendantsOfKind(SyntaxKind.BinaryExpression)
      .find((expr) =>
        expr
          .getText()
          .includes(
            "route = new RouteImpl(requestPausedSessionInfo!.session, requestPausedEvent.requestId)",
          ),
      );
    // Adding new parameter to the RouteImpl call
    if (routeAssignment) {
      routeAssignment
        .getRight()
        .replaceWithText(
          "new RouteImpl(requestPausedSessionInfo!.session, requestPausedEvent.requestId, this._page, requestPausedEvent.networkId, this)",
        );
    }

    // -- _updateProtocolRequestInterceptionForSession Method --
    const updateProtocolRequestInterceptionForSessionMethod = crNetworkManagerClass.getMethod("_updateProtocolRequestInterceptionForSession");
    // Remove old loop and logic for localFrames and isolated world creation
    updateProtocolRequestInterceptionForSessionMethod.getStatements().forEach((statement) => {
      const text = statement.getText();
      // Check if the statement matches the patterns
      if (text.includes('const cachePromise = info.session.send(\'Network.setCacheDisabled\', { cacheDisabled: enabled });'))
        statement.replaceWithText('const cachePromise = info.session.send(\'Network.setCacheDisabled\', { cacheDisabled: false });');
    });

    // -- _handleRequestRedirect Method --
    //const handleRequestRedirectMethod = crNetworkManagerClass.getMethod("_handleRequestRedirect");
    //handleRequestRedirectMethod.setBodyText('return;')

    // -- _onRequest Method --
    const crOnRequestMethod = crNetworkManagerClass.getMethod("_onRequest");
    const crOnRequestMethodBody = crOnRequestMethod.getBody();
    crOnRequestMethodBody.insertStatements(0, 'if (this._alreadyTrackedNetworkIds.has(requestWillBeSentEvent.initiator.requestId)) return;')

    // -- _onRequestPaused Method --
    const onRequestPausedMethod = crNetworkManagerClass.getMethod("_onRequestPaused");
    const onRequestPausedMethodBody = onRequestPausedMethod.getBody();
    onRequestPausedMethodBody.insertStatements(0, 'if (this._alreadyTrackedNetworkIds.has(event.networkId)) return;')


    // ------- RouteImpl Class -------
    const routeImplClass = crNetworkManagerSourceFile.getClass("RouteImpl");

    // -- RouteImpl Constructor --
    const constructorDeclaration = routeImplClass
      .getConstructors()
      .find((ctor) =>
        ctor
          .getText()
          .includes("constructor(session: CRSession, interceptionId: string)"),
      );
    // Get current parameters and add the new `page` parameter
    const parameters = constructorDeclaration.getParameters();
    // Adding the 'page' parameter
    constructorDeclaration.insertParameter(parameters.length, { name: "page" });
    constructorDeclaration.insertParameter(parameters.length+1, { name: "networkId" });
    constructorDeclaration.insertParameter(parameters.length+2, { name: "sessionManager" });
    // Modify the constructor's body to include `this._page = page;` and other properties
    const body = constructorDeclaration.getBody();
    body.insertStatements(0, "this._page = void 0;");
    body.insertStatements(0, "this._networkId = void 0;");
    body.insertStatements(0, "this._sessionManager = void 0;");
    body.addStatements("this._page = page;");
    body.addStatements("this._networkId = networkId;");
    body.addStatements("this._sessionManager = sessionManager;");
    body.addStatements("eventsHelper.addEventListener(this._session, 'Fetch.requestPaused', async e => await this._networkRequestIntercepted(e));");

    // -- fulfill Method --
    const fulfillMethod = routeImplClass.getMethodOrThrow("fulfill");
    // Replace the body of the fulfill method with custom code
    fulfillMethod.setBodyText(`
      const isTextHtml = response.headers.some((header) => header.name.toLowerCase() === 'content-type' && header.value.includes('text/html'));
      var allInjections = [...this._page.delegate._mainFrameSession._evaluateOnNewDocumentScripts];
          for (const binding of this._page.delegate._browserContext._pageBindings.values()) {
            if (!allInjections.includes(binding)) allInjections.push(binding);
          }
      if (isTextHtml && allInjections.length) {
        // I Chatted so hard for this Code
        let scriptNonce = crypto.randomBytes(22).toString('hex');
        let useNonce = true;
        for (let i = 0; i < response.headers.length; i++) {
          if (response.headers[i].name.toLowerCase() === 'content-security-policy' || response.headers[i].name.toLowerCase() === 'content-security-policy-report-only') {
            // Search for an existing script-src nonce that we can hijack
            let cspValue = response.headers[i].value;
            const nonceRegex = /script-src[^;]*'nonce-([\\w-]+)'/;
            const nonceMatch = cspValue.match(nonceRegex);
            if (nonceMatch) {
              scriptNonce = nonceMatch[1];
            } else {
              // If there was an 'unsafe-inline' expression present the addition of 'nonce' would nullify it.
              if (/script-src[^;]*'unsafe-inline'/.test(cspValue)) {
                useNonce = false;
              } else {
                // If there is no nonce, we will inject one.
                const scriptSrcRegex = /(script-src[^;]*)(;|$)/;
                const newCspValue = cspValue.replace(scriptSrcRegex, \`\$1 'nonce-\${scriptNonce}'\$2\`);
                response.headers[i].value = newCspValue;
              }
            }
            break;
          }
        }
        let injectionHTML = "";
        allInjections.forEach((script) => {
          let scriptId = crypto.randomBytes(22).toString('hex');
          let scriptSource = script.source || script;
          if (useNonce) {
            injectionHTML += \`<script class="\${this._page.delegate.initScriptTag}" nonce="\${scriptNonce}" id="\${scriptId}" type="text/javascript">document.getElementById("\${scriptId}")?.remove();\${scriptSource}</script>\`;
          } else {
            injectionHTML += \`<script class="\${this._page.delegate.initScriptTag}" id="\${scriptId}" type="text/javascript">document.getElementById("\${scriptId}")?.remove();\${scriptSource}</script>\`;
          }
        });
        if (response.isBase64) {
          response.isBase64 = false;
          response.body = Buffer.from(response.body, "base64").toString("utf-8");
        }
        // Inject injectionHTML after all <meta> and <link> tags in the <head>, but before any <script> tags, to make sure the init scripts are executed first.
        const headMatch = response.body.match(/<head[^>]*>[\s\S]*?<\/head>/i);
        if (headMatch) {
          response.body = response.body.replace(/(<head[^>]*>)([\s\S]*?)(<\/head>)/i, (match, headOpen, headContent, headClose) => {
            const scriptMatch = headContent.match(/([\s\S]*?)(<script\b[\s\S]*?$)/i);
            if (scriptMatch) {
              const [beforeScript, fromScript] = [scriptMatch[1], scriptMatch[2]];
              return \`\${headOpen}\${beforeScript}\${injectionHTML}\${fromScript}\${headClose}\`;
            }
            return \`\${headOpen}\${headContent}\${injectionHTML}\${headClose}\`;
          });
        } else if (/^<!DOCTYPE[\s\S]*?>/i.test(body)) {
          // No head, but has doctype: inject right after it
           response.body = response.body.replace(/^<!DOCTYPE[\s\S]*?>/i, match => \`\${match}\${injectionHTML}\`);
        } else if (/<html[^>]*>/i.test(body)) {
          // No head, inject right after <html>
          response.body = response.body.replace(/<html[^>]*>/i, \`\$&<head>\${injectionHTML}</head>\`);
        } else {
          // Absolute fallback: prepend
          response.body = injectionHTML + response.body;
        }
      }
      this._fulfilled = true;
      const body = response.isBase64 ? response.body : Buffer.from(response.body).toString('base64');
      const responseHeaders = splitSetCookieHeader(response.headers);
      await catchDisallowedErrors(async () => {
        await this._session.send('Fetch.fulfillRequest', {
          requestId: response.interceptionId ? response.interceptionId : this._interceptionId,
          responseCode: response.status,
          responsePhrase: network.statusText(response.status),
          responseHeaders,
          body,
        });
      });
    `);

    // -- continue --
    const continueMethod = routeImplClass.getMethodOrThrow("continue");
    continueMethod.setBodyText(`
      this._alreadyContinuedParams = {
        requestId: this._interceptionId,
        url: overrides.url,
        headers: overrides.headers,
        method: overrides.method,
        postData: overrides.postData ? overrides.postData.toString('base64') : undefined,
      };
      if (overrides.url && (overrides.url === 'http://patchright-init-script-inject.internal/' || overrides.url === 'https://patchright-init-script-inject.internal/')) {
        await catchDisallowedErrors(async () => {
          this._sessionManager._alreadyTrackedNetworkIds.add(this._networkId);
          this._session._sendMayFail('Fetch.continueRequest', { requestId: this._interceptionId, interceptResponse: true });
        });
      } else {
        await catchDisallowedErrors(async () => {
          await this._session._sendMayFail('Fetch.continueRequest', this._alreadyContinuedParams);
        });
      }
    `);

    // -- _networkRequestIntercepted Method --
    routeImplClass.addMethod({
      name: "_networkRequestIntercepted",
      isAsync: true,
      parameters: [
        { name: "event" },
      ]
    });
    const networkRequestInterceptedMethod = routeImplClass.getMethod("_networkRequestIntercepted");
    networkRequestInterceptedMethod.setBodyText(`
      if (event.resourceType !== 'Document') {
        /*await catchDisallowedErrors(async () => {
          await this._session.send('Fetch.continueRequest', { requestId: event.requestId });
        });*/
        return;
      }
      if (this._networkId != event.networkId || !this._sessionManager._alreadyTrackedNetworkIds.has(event.networkId)) return;
      try {
        if (event.responseStatusCode >= 301 && event.responseStatusCode <= 308  || (event.redirectedRequestId && !event.responseStatusCode)) {
          await this._session.send('Fetch.continueRequest', { requestId: event.requestId, interceptResponse: true });
        } else {
          const responseBody = await this._session.send('Fetch.getResponseBody', { requestId: event.requestId });
          await this.fulfill({
            headers: event.responseHeaders,
            isBase64: true,
            body: responseBody.body,
            status: event.responseStatusCode,
            interceptionId: event.requestId,
            resourceType: event.resourceType,
          })
        }
      } catch (error) {
        await this._session._sendMayFail('Fetch.continueRequest', { requestId: event.requestId });
      }
    `);
}