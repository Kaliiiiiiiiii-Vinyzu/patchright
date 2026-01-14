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

    // -- _fixCSP Method --
    routeImplClass.addMethod({
      name: "_fixCSP",
      isAsync: false,
      parameters: [
        { name: "csp" }, 
        { name: "scriptNonce" },
      ]
    });
    const fixCSPMethod = routeImplClass.getMethod("_fixCSP");
    fixCSPMethod.setBodyText(`
      if (!csp || typeof csp !== 'string') return csp;

      // Split by semicolons and clean up
      const directives = csp.split(';')
        .map(d => d.trim())
        .filter(d => d && d.length > 0);

      const fixedDirectives = [];
      let hasScriptSrc = false;

      for (let directive of directives) {
        // Skip empty directives
        if (!directive.trim()) continue;

        // Improved directive parsing to handle more edge cases
        const directiveMatch = directive.match(/^([a-zA-Z-]+)\\s+(.*)$/);
        if (!directiveMatch) {
          fixedDirectives.push(directive);
          continue;
        }

        const directiveName = directiveMatch[1].toLowerCase();
        const directiveValues = directiveMatch[2].split(/\\s+/).filter(v => v.length > 0);

        switch (directiveName) {
          case 'script-src':
            hasScriptSrc = true;
            let values = [...directiveValues];

            // Add nonce if we have one and it's not already present
            if (scriptNonce && !values.some(v => v.includes(\`nonce-\${scriptNonce}\`))) {
              values.push(\`'nonce-\${scriptNonce}'\`);
            }

            // Add 'unsafe-eval' if not present
            if (!values.includes("'unsafe-eval'")) {
              values.push("'unsafe-eval'");
            }

            // Add unsafe-inline if not present and no nonce is being used
            if (!values.includes("'unsafe-inline'") && !scriptNonce) {
              values.push("'unsafe-inline'");
            }

            // Add wildcard for external scripts if not already present
            if (!values.includes("*") && !values.includes("'self'") && !values.some(v => v.includes("https:"))) {
              values.push("*");
            }

            fixedDirectives.push(\`script-src \${values.join(' ')}\`);
            break;

          case 'style-src':
            let styleValues = [...directiveValues];
            // Add 'unsafe-inline' for styles if not present
            if (!styleValues.includes("'unsafe-inline'")) {
              styleValues.push("'unsafe-inline'");
            }
            fixedDirectives.push(\`style-src \${styleValues.join(' ')}\`);
            break;

          case 'img-src':
            let imgValues = [...directiveValues];
            // Allow data: URLs for images if not already allowed
            if (!imgValues.includes("data:") && !imgValues.includes("*")) {
              imgValues.push("data:");
            }
            fixedDirectives.push(\`img-src \${imgValues.join(' ')}\`);
            break;

          case 'font-src':
            let fontValues = [...directiveValues];
            // Allow data: URLs for fonts if not already allowed
            if (!fontValues.includes("data:") && !fontValues.includes("*")) {
              fontValues.push("data:");
            }
            fixedDirectives.push(\`font-src \${fontValues.join(' ')}\`);
            break;

          case 'connect-src':
            let connectValues = [...directiveValues];
            // Allow WebSocket connections if not already allowed
            const hasWs = connectValues.some(v => v.includes("ws:") || v.includes("wss:") || v === "*");
            if (!hasWs) {
              connectValues.push("ws:", "wss:");
            }
            fixedDirectives.push(\`connect-src \${connectValues.join(' ')}\`);
            break;

          case 'frame-ancestors':
            let frameAncestorValues = [...directiveValues];
            // If completely blocked with 'none', allow 'self' at least
            if (frameAncestorValues.includes("'none'")) {
              frameAncestorValues = ["'self'"];
            }
            fixedDirectives.push(\`frame-ancestors \${frameAncestorValues.join(' ')}\`);
            break;

          default:
            // Keep other directives as-is
            fixedDirectives.push(directive);
            break;
        }
      }

      // Add script-src if it doesn't exist (for our injected scripts)
      if (!hasScriptSrc) {
        if (scriptNonce) {
          fixedDirectives.push(\`script-src 'self' 'unsafe-eval' 'nonce-\${scriptNonce}' *\`);
        } else {
          fixedDirectives.push(\`script-src 'self' 'unsafe-eval' 'unsafe-inline' *\`);
        }
      }

      return fixedDirectives.join('; ');
    `);

    // -- fulfill Method --
    const fulfillMethod = routeImplClass.getMethodOrThrow("fulfill");
    // Replace the body of the fulfill method with custom code
    fulfillMethod.setBodyText(`
      const isTextHtml = response.headers.some((header) => header.name.toLowerCase() === "content-type" && header.value.includes("text/html"));
      var allInjections = [...this._page.delegate._mainFrameSession._evaluateOnNewDocumentScripts];
      if (isTextHtml && allInjections.length) {
        let useNonce = false;
        let scriptNonce = null;
        // Decode body if needed
        if (response.isBase64) {
          response.isBase64 = false;
          response.body = Buffer.from(response.body, "base64").toString("utf-8");
        }
        // === CSP Detection and Fixing ===
        const cspHeaderNames = ["content-security-policy", "content-security-policy-report-only"];
        // Fix CSP in headers
        for (let i = 0; i < response.headers.length; i++) {
          const headerName = response.headers[i].name.toLowerCase();
          if (cspHeaderNames.includes(headerName)) {
            const originalCsp = response.headers[i].value || "";
            // Extract nonce if present
            if (!useNonce) {
              const nonceMatch = originalCsp.match(/script-src[^;]*'nonce-([^'"\\s;]+)'/i);
              if (nonceMatch && nonceMatch[1]) {
                scriptNonce = nonceMatch[1];
                useNonce = true;
              }
            }
            
            const fixedCsp = this._fixCSP(originalCsp, scriptNonce);
            response.headers[i].value = fixedCsp;
          }
        }
        
        // Fix CSP in meta tags
        if (typeof response.body === "string" && response.body.length) {
          response.body = response.body.replace(
            /<meta\b[^>]*http-equiv=(?:"|')?Content-Security-Policy(?:"|')?[^>]*>/gi,
            (match) => {
              const contentMatch = match.match(/\bcontent=(?:"|')([^"']*)(?:"|')/i);
              if (contentMatch && contentMatch[1]) {
                let originalCsp = contentMatch[1];
                
                // Decode HTML entities
                originalCsp = originalCsp.replace(/&amp;/g, '&')  // Must be first!
                    .replace(/&lt;/g, '<')
                    .replace(/&gt;/g, '>')
                    .replace(/&quot;/g, '"')
                    .replace(/&#x27;/g, "'")
                    .replace(/&#x22;/g, '"')
                    .replace(/&nbsp;/g, ' ')
                    .replace(/&#(\d+);/g, (match, dec) => String.fromCharCode(dec))
                    .replace(/&#x([0-9a-fA-F]+);/g, (match, hex) => String.fromCharCode(parseInt(hex, 16)));
                
                // Extract nonce if not already found
                if (!useNonce) {
                  const nonceMatch = originalCsp.match(/script-src[^;]*'nonce-([^'"\\s;]+)'/i);
                  if (nonceMatch && nonceMatch[1]) {
                    scriptNonce = nonceMatch[1];
                    useNonce = true;
                  }
                }
                
                const fixedCsp = this._fixCSP(originalCsp, scriptNonce);
                // Re-encode for HTML
                const encodedCsp = fixedCsp.replace(/'/g, '&#x27;').replace(/"/g, '&#x22;');
                return match.replace(contentMatch[1], encodedCsp);
              }
              return match;
            }
          );
        }
        
        // Build injection HTML - only use nonce if one was found in existing CSP
        let injectionHTML = "";
        allInjections.forEach((script) => {
          let scriptId = crypto.randomBytes(22).toString("hex");
          let scriptSource = script.source || script;
          const nonceAttr = useNonce ? \`nonce="\${scriptNonce}"\` : '';
          injectionHTML += \`<script class="\${this._page.delegate.initScriptTag}" \${nonceAttr} id="\${scriptId}" type="text/javascript">document.getElementById("\${scriptId}")?.remove();\${scriptSource}</script>\`;
        });

        // Inject at END of <head>
        const lower = response.body.toLowerCase();
        const headStartIndex = lower.indexOf("<head");
        if (headStartIndex !== -1) {
          const headEndTagIndex = lower.indexOf("</head>", headStartIndex);
          if (headEndTagIndex !== -1) {
            // Find the head opening tag end
            const headOpenEnd = response.body.indexOf(">", headStartIndex) + 1;
            const headContent = response.body.slice(headOpenEnd, headEndTagIndex);
            const headContentLower = headContent.toLowerCase();
            
            // Look for the first <script> tag in the head content
            // but ignore comments
            let firstScriptIndex = -1;
            let searchPos = 0;
            const endSearchPos = headContentLower.length;

            while (searchPos < endSearchPos) {
                const commentStart = headContentLower.indexOf("<!--", searchPos);
                const scriptStart = headContentLower.indexOf("<script", searchPos);
                // No more script tags, inject at the end of head content
                if (scriptStart === -1 || scriptStart >= endSearchPos) {
                    break;
                }

                if (commentStart !== -1 && commentStart < scriptStart) {
                    const commentEnd = headContentLower.indexOf("-->", commentStart);
                    if (commentEnd !== -1) {
                        // continue search after the comment
                        searchPos = commentEnd + 3;
                        continue;
                    } else {
                        break;
                    }
                }

                // Found a script tag
                firstScriptIndex = scriptStart;
                break;
            }
            
            if (firstScriptIndex !== -1) {
              // Inject before the first script tag
              const insertPosition = headOpenEnd + firstScriptIndex;
              response.body =
                response.body.slice(0, insertPosition) +
                injectionHTML +
                response.body.slice(insertPosition);
            } else {
              // No script tags found, inject at the end of head content (before </head>)
              response.body =
                response.body.slice(0, headEndTagIndex) +
                injectionHTML +
                response.body.slice(headEndTagIndex);
            }
          } else {
            const headStartTagEnd = response.body.indexOf(">", headStartIndex) + 1;
            response.body =
              response.body.slice(0, headStartTagEnd) +
              injectionHTML +
              response.body.slice(headStartTagEnd);
          }
        } else {
          const doctypeIndex = lower.indexOf("<!doctype");
          if (doctypeIndex === 0) {
            const doctypeEnd = response.body.indexOf(">", doctypeIndex) + 1;
            response.body = response.body.slice(0, doctypeEnd) + injectionHTML + response.body.slice(doctypeEnd);
          } else {
            const htmlIndex = lower.indexOf("<html");
            if (htmlIndex !== -1) {
              const htmlTagEnd = response.body.indexOf(">", htmlIndex) + 1;
              response.body =
                response.body.slice(0, htmlTagEnd) + \`<head>\${injectionHTML}</head>\` + response.body.slice(htmlTagEnd);
            } else {
              response.body = injectionHTML + response.body;
            }
          }
        }
      }
      this._fulfilled = true;
      const body = response.isBase64 ? response.body : Buffer.from(response.body).toString("base64");
      const responseHeaders = splitSetCookieHeader(response.headers);
      await catchDisallowedErrors(async () => {
        await this._session.send("Fetch.fulfillRequest", {
          requestId: response.interceptionId ? response.interceptionId : this._interceptionId,
          responseCode: response.status,
          responsePhrase: network.statusText(response.status),
          responseHeaders,
          body
        });
      });
    `);

    // -- continue Method --
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
        // Skip fulfill for browser's privilege pages, such as Edge's new tab page.
        // These pages have special security contexts and Fetch.fulfillRequest may cause crashes
        const url = event.request?.url || '';
        const isPrivilegePage = url.startsWith("https://ntp.msn");
        if (isPrivilegePage) {
          await this._session._sendMayFail("Fetch.continueRequest", { requestId: event.requestId });
          return;
        }
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
