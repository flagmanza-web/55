/**
 * Copyright 2018 Google Inc. All Rights Reserved.
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *     http://www.apache.org/licenses/LICENSE-2.0
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

// If the loader is already loaded, just stop.
if (!self.define) {
  let registry = {};

  // Used for `eval` and `importScripts` where we can't get script URL by other means.
  // In both cases, it's safe to use a global var because those functions are synchronous.
  let nextDefineUri;

  const singleRequire = (uri, parentUri) => {
    uri = new URL(uri + ".js", parentUri).href;
    return registry[uri] || (
      
        new Promise(resolve => {
          if ("document" in self) {
            const script = document.createElement("script");
            script.src = uri;
            script.onload = resolve;
            document.head.appendChild(script);
          } else {
            nextDefineUri = uri;
            importScripts(uri);
            resolve();
          }
        })
      
      .then(() => {
        let promise = registry[uri];
        if (!promise) {
          throw new Error(`Module ${uri} didn’t register its module`);
        }
        return promise;
      })
    );
  };

  self.define = (depsNames, factory) => {
    const uri = nextDefineUri || ("document" in self ? document.currentScript.src : "") || location.href;
    if (registry[uri]) {
      // Module is already loading or loaded.
      return;
    }
    let exports = {};
    const require = depUri => singleRequire(depUri, uri);
    const specialDeps = {
      module: { uri },
      exports,
      require
    };
    registry[uri] = Promise.all(depsNames.map(
      depName => specialDeps[depName] || require(depName)
    )).then(deps => {
      factory(...deps);
      return exports;
    });
  };
}
define(['./workbox-7e5eb42b'], (function (workbox) { 'use strict';

  self.skipWaiting();
  workbox.clientsClaim();
  /**
   * The precacheAndRoute() method efficiently caches and responds to
   * requests for URLs in the manifest.
   * See https://goo.gl/S9QRab
   */
  workbox.precacheAndRoute([{
    "url": "pwa-maskable-512x512.png",
    "revision": "6e5d68715fd9dd3094d1302ccfceb81f"
  }, {
    "url": "pwa-512x512.png",
    "revision": "e3bbdce4bc0513e25946a27b59f94819"
  }, {
    "url": "pwa-192x192.png",
    "revision": "c6b81a07cc0448f1cd1f8e3478bd14b1"
  }, {
    "url": "index.html",
    "revision": "bd300dcd23006e8c465402d41b0582f0"
  }, {
    "url": "icon.svg",
    "revision": "5f83ded53bc70fc269fe2712fa034dbd"
  }, {
    "url": "apple-touch-icon.png",
    "revision": "0b3e0cbed11403b2c8a5cb18faa97a9a"
  }, {
    "url": "assets/workbox-window.prod.es5-Bd17z0YL.js",
    "revision": null
  }, {
    "url": "assets/index-H3q5YRHV.css",
    "revision": null
  }, {
    "url": "assets/index-CnZlU9ji.js",
    "revision": null
  }, {
    "url": "apple-touch-icon.png",
    "revision": "0b3e0cbed11403b2c8a5cb18faa97a9a"
  }, {
    "url": "icon.svg",
    "revision": "5f83ded53bc70fc269fe2712fa034dbd"
  }, {
    "url": "pwa-192x192.png",
    "revision": "c6b81a07cc0448f1cd1f8e3478bd14b1"
  }, {
    "url": "pwa-512x512.png",
    "revision": "e3bbdce4bc0513e25946a27b59f94819"
  }, {
    "url": "pwa-maskable-512x512.png",
    "revision": "6e5d68715fd9dd3094d1302ccfceb81f"
  }, {
    "url": "manifest.webmanifest",
    "revision": "e774d6c2bbd468eaa590620010baa6f6"
  }], {});
  workbox.cleanupOutdatedCaches();
  workbox.registerRoute(new workbox.NavigationRoute(workbox.createHandlerBoundToURL("index.html"), {
    denylist: [/^\/api\//]
  }));

}));
