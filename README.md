<div align="center">
    <d>
        <a href="" title="Vulcan" target="_blank">
            <img src="./.github/resources/banner.png">
        </a>
    </p>
    <p>
    <a href="https://travis-ci.org/GitPaulo/Vulcan" title="Build Status"><img src="https://travis-ci.org/GitPaulo/Vulcan.svg?branch=master"></a>
    <a href="https://github.com/prettier/prettier" title="Code Style"><img src="https://img.shields.io/badge/code_style-prettier-ff69b4.svg?style=flat-square"></a>
    <a href="https://www.codacy.com/app/GitPaulo/Vulcan?utm_source=github.com&amp;utm_medium=referral&amp;utm_content=GitPaulo/Vulcan&amp;utm_campaign=Badge_Grade" title="Code Quality"><img src="https://api.codacy.com/project/badge/Grade/f7e68b17b25b4f43b2bfd74756e488fb"/></a>
    </p>
    <p>
    <a href="https://forthebadge.com/">
    <img src="https://forthebadge.com/images/badges/contains-cat-gifs.svg">
    <img src="https://forthebadge.com/images/badges/built-with-love.svg">
    </a>
    </p>
</div>

# Overview

**Vulcan** is a multi-purpose discord bot built with [discord.js](https://github.com/discordjs/discord.js). Vulcan's goal is to enhance the environment within our discord server. Note that its design and features are exclusively tailored to our needs.

This project is maintained only by a few people, but you are welcome to join!

# Invite Vulcan

Vulcan's features are **disabled by default** on **new guilds**; they must be activated by one of the bot owners.

Note that this is **intended**. Once Vulcan is invited to a new server, an automatic request to enable its features on the new guild is sent to the bot owners. You may also use the `authorise` command to manually send a request.

To invite Vulcan to your discord server simply click the image link below:

<a href="https://discordapp.com/oauth2/authorize?client_id=604662534410207233&scope=bot&permissions=1341644225" title="Vulcan-invite" target="_blank">
    <img src="./.github/resources/join.png" width="30%" height="30%">
</a>

# Self Hosting

There is no bundle/executable at this moment in time. \
To self host, you must make sure you are on a compatible platform and follow these steps:

1. Download and install [python (v2.x)](https://www.python.org/downloads/).
2. Download and install [node & npm (stable)](https://nodejs.org/en/download/).
   - We recommend using [NVM](https://stackabuse.com/using-nvm-to-install-node/).
3. Clone repository using [git](https://git-scm.com/) OR Download and extract the [zipped repository code](https://github.com/Vulcan-Group/Vulcan.git).
4. Open a [shell](https://git-scm.com/downloads) in the location of directory of the downloaded source code.
5. Run: `npm ci && npm run exec:components`.
6. Navigate to the new `'settings'` folder and fill in the required configuration & credentials details.
7. Run : `npm start` or `npm run production` for the production mode.

## Easy Booting

If you want, you may ignore the steps above and just run the following command:

```sh
./shell/boot.sh
```

\*_admin shell required_

### Not working?

Please make sure you have [bash](https://www.gnu.org/software/bash/) installed and run the command from the **root** of the project.

## Supported Platforms

This bot has been tested to work on:

- Ubuntu 18.04.4 LTS (Bionic Beaver)
- Windows 10 (x64)

\*_if you have a problem... its probably not our fault_

# Contributing

In most cases, only friends are allowed to contribute. \
For contributions please read the [contribution guideline](./.github/CONTRIBUTING.md).

# FAQ

May I use code in this repository?

- **Yes.** Follow the license.

May I host this program publicly?

- **Yes.** Credit this repository and follow the license.

May I invite the bot?

- **Yes.** However there is a good chance of your guild being denied. The bot is mostly for **personal** use.
