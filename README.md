<h1 align="center">
    🎭 Patchright
</h1>


<p align="center">
    <a href="https://github.com/Kaliiiiiiiiii-Vinyzu/patchright/blob/main/LICENSE">
        <img src="https://img.shields.io/badge/License-Apache%202.0-green">
    </a>
    <a>
        <img src="https://img.shields.io/badge/Based%20on-Playwright-goldenrod">
    </a>
    <a href="https://github.com/Kaliiiiiiiiii-Vinyzu/patchright-python/actions/workflows/patchright_tests.yml">
        <img src="https://github.com/Kaliiiiiiiiii-Vinyzu/patchright-python/actions/workflows/patchright_tests.yml/badge.svg">
    </a>
    <a>
        <img src="https://img.shields.io/badge/Driver-Patched-blue">
    </a>
    <a href="https://github.com/Kaliiiiiiiiii-Vinyzu/patchright/releases/latest">
        <img alt="Patchright Version" src="https://img.shields.io/github/v/release/Kaliiiiiiiiii-Vinyzu/patchright?display_name=release&label=Version">
    </a>
<br/>
    <a href="https://github.com/Kaliiiiiiiiii-Vinyzu/patchright-python">
        <img src="https://img.shields.io/badge/Package-Python-seagreen">
    </a>
    <a href="https://github.com/Kaliiiiiiiiii-Vinyzu/patchright-python/releases">
        <img alt="Python Downloads" src="https://img.shields.io/pepy/dt/patchright?color=red&label=Python%20Downloads">
    </a>
    <a href="https://github.com/Kaliiiiiiiiii-Vinyzu/patchright-nodejs">
        <img src="https://img.shields.io/badge/Package-NodeJS-seagreen">
    </a>
    <a href="https://github.com/Kaliiiiiiiiii-Vinyzu/patchright-nodejs/releases">
        <img alt="NodeJS Downloads" src="https://img.shields.io/npm/d18m/patchright?color=red&label=NodeJS%20Downloads">
    </a>
    <a href="https://github.com/DevEnterpriseSoftware/patchright-dotnet">
        <img src="https://img.shields.io/badge/Package-.Net-seagreen">
    </a>
    <a href="https://github.com/Kaliiiiiiiiii-Vinyzu/patchright-nodejs/releases">
        <img alt=".Net Downloads" src="https://img.shields.io/nuget/dt/Patchright?label=Downloads">
    </a>
</p>

#### Patchright is a patched and undetected version of the Playwright Testing and Automation Framework. </br> It can be used as a drop-in replacement for Playwright.

> [!NOTE]  
> This repository serves the Patchright Driver. To use Patchright, check out the [Python Package](https://github.com/Kaliiiiiiiiii-Vinyzu/patchright-python), the [NodeJS Package](https://github.com/Kaliiiiiiiiii-Vinyzu/patchright-nodejs) or the _community-driven_ [.Net Package](https://github.com/DevEnterpriseSoftware/patchright-dotnet/)

> [!IMPORTANT]  
> Patchright only patches CHROMIUM based browsers. Firefox and Webkit are not supported.

---

<details open>
    <summary><h3>Sponsors</h1></summary>

 <a href="https://hyperbrowser.ai/"><img alt="Hyperbrowser Banner Ad" src="https://github.com/user-attachments/assets/7132b07b-8543-4381-9b9d-02f706f5db4b" width="80%"/></a>
 </br>
If you’re looking for a high-performance browser automation platform checkout [**Hyperbrowser**](https://hyperbrowser.ai/). It’s ideal for AI Agents, large-scale web scraping and automated testing. </br>
[**Hyperbrowser**](https://hyperbrowser.ai/) delivers cloud-based browser infrastructure that scales instantly from a few sessions to thousands, with built-in CAPTCHA solving, stealth fingerprinting, and a global proxy network. It integrates seamlessly with Puppeteer, Playwright, and Selenium, so you can be up and running in minutes, no server or proxy management required.

Key Features:
- **Instant scaling**: Launch 1,000+ concurrent browsers
- **Captcha Solving**: Handles reCAPTCHA, Cloudflare, AWS, and more
- **Stealth mode**: Dynamic, human-like fingerprints for undetectable automation
- **Global proxy network**: 170+ countries with rotation and geo-targeting
- **Built-in debugging**: Live view and session replay for real-time monitoring
- **1-line integration**: Works with Puppeteer, Playwright, Selenium in Node.js or Python

👉 Learn more at [**hyperbrowser.ai**](https://hyperbrowser.ai/)

</details>

---

## Patches

### [Runtime.enable](https://vanilla.aslushnikov.com/?Runtime.enable) Leak
This is the biggest Patch Patchright uses. To avoid detection by this leak, patchright avoids using [Runtime.enable](https://vanilla.aslushnikov.com/?Runtime.enable) by executing Javascript in (isolated) ExecutionContexts.

### [Console.enable](https://vanilla.aslushnikov.com/?Console.enable) Leak
Patchright patches this leak by disabling the Console API all together. This means, console functionality will not work in Patchright. If you really need the console, you might be better off using Javascript loggers, although they also can be easily detected.

### Command Flags Leaks
Patchright tweaks the Playwright Default Args to avoid detection by Command Flag Leaks. This (most importantly) affects:
- `--disable-blink-features=AutomationControlled` (added) to avoid navigator.webdriver detection.
- `--enable-automation` (removed) to avoid navigator.webdriver detection.
- `--disable-popup-blocking` (removed) to avoid popup crashing.
- `--disable-component-update` (removed) to avoid detection as a Stealth Driver.
- `--disable-default-apps` (removed) to enable default apps.
- `--disable-extensions` (removed) to enable extensions

### General Leaks
Patchright patches some general leaks in the Playwright codebase. This mainly includes poor setups and obvious detection points.

### Closed Shadow Roots
Patchright is able to interact with elements in Closed Shadow Roots. Just use normal locators and Patchright will do the rest.
<br/>
Patchright is now also able to use XPaths in Closed Shadow Roots.

---

## Stealth

With the right setup, Patchright currently is considered undetectable.
Patchright passes:
- [Brotector](https://kaliiiiiiiiii.github.io/brotector/) ✅ (with [CDP-Patches](https://github.com/Kaliiiiiiiiii-Vinyzu/CDP-Patches/))
- [Cloudflare](https://cloudflare.com/) ✅
- [Kasada](https://www.kasada.io/) ✅
- [Akamai](https://www.akamai.com/products/bot-manager/) ✅
- [Shape/F5](https://www.f5.com/) ✅
- [Bet365](https://bet365.com/) ✅
- [Datadome](https://datadome.co/products/bot-protection/) ✅
- [Fingerprint.com](https://fingerprint.com/products/bot-detection/) ✅
- [CreepJS](https://abrahamjuliot.github.io/creepjs/) ✅
- [Sannysoft](https://bot.sannysoft.com/) ✅
- [Incolumitas](https://bot.incolumitas.com/) ✅
- [IPHey](https://iphey.com/) ✅
- [Browserscan](https://browserscan.net/) ✅
- [Pixelscan](https://pixelscan.net/) ✅

---

## Bugs
#### Even though we have spent a lot of time to make Patchright as stable as possible, bugs may still occur. If you encounter any bugs, please report them in the [Issues](https://github.com/Kaliiiiiiiiii-Vinyzu/patchright/issues).
#### Patchright is now tested against the Playwright Tests after every release. See [here](https://github.com/Kaliiiiiiiiii-Vinyzu/patchright-python/actions/workflows/patchright_tests.yml)

> [!WARNING]  
> Patchright passes most, but not all the Playwright tests. Some bugs are considered impossible to solve, some are just not relevant. See the list of bugs and their explanation [here](https://github.com/Kaliiiiiiiiii-Vinyzu/patchright/issues/30).

#### Based on the Playwright Tests, we concluded that its highly unlikely that you will be affected by these bugs in regular usecases.

<details>
    <summary><b>Init Script Shenanigans</b></summary>

### Explanation
To be able to use InitScripts without [Runtime.enable](https://vanilla.aslushnikov.com/?Runtime.enable), Patchright uses Playwright Routes to inject JavaScript into HTML requests.

### Bugs
Playwright Routes may cause some bugs in other parts of your code. Patchright InitScripts won't cause any bugs that wouldn't be caused by normal Playwright Routes. </br> If you want any of these bugs fixed, you'll have to contact the Playwright team.

### Leaks
Patchright InitScripts can be detected by Timing Attacks. However, no antibot currently checks for this kind of Timing Attack and they probably won't for a good amount of time. </br> We consider them not to be a big risk of detection.

</details>

---

### TODO
- [x] Implement Option to choose Execution Context (Main/Isolated).
- [x] Fix Fixable Bugs.
- [x] Implement .patch Updater to easily show Patchright's patches.
- [x] Setup Automated Testing on new Release.
- [x] Implement Patchright on .NET.
- [ ] Implement Patchright on Java.

---

## Development

Deployment of new Patchright versions are automatic, but bugs due to Playwright codebase changes may occur. Fixes for these bugs might take a few days to be released. 

---

## Support our work

If you choose to support our work, please contact [@vinyzu](https://discord.com/users/935224495126487150) or [@steve_abcdef](https://discord.com/users/936292409426477066) on Discord.

---

## Copyright and License
© [Vinyzu](https://github.com/Vinyzu/)

Patchright is licensed [Apache 2.0](https://choosealicense.com/licenses/apache-2.0/)

[Some Parts](https://github.com/Kaliiiiiiiiii-Vinyzu/patchright/blob/main/patchright_driver_patch.js#L435-L448) of the Codebase are inspired by [Driverless](https://github.com/kaliiiiiiiiii/Selenium-Driverless).
Thanks to [Nick Webson](https://github.com/rebrowser/rebrowser-patches) for the idea of .patch-File Documentation.

---

## Disclaimer

This repository is provided for **educational purposes only**. \
No warranties are provided regarding accuracy, completeness, or suitability for any purpose. **Use at your own risk**—the authors and maintainers assume **no liability** for **any damages**, **legal issues**, or **warranty breaches** resulting from use, modification, or distribution of this code.\
**Any misuse or legal violations are the sole responsibility of the user**. 

---

## Authors

#### Active Maintainer: [Vinyzu](https://github.com/Vinyzu/) </br> Co-Maintainer: [Kaliiiiiiiiii](https://github.com/kaliiiiiiiiii/)
