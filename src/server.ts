import fastify from "fastify";
import { FastifyInstance } from "fastify/types/instance";
import { ethers } from "ethers";
// @ts-ignore
import { INFURA_KEY, MOVIE_NAME, NODE_ENV, CERT_PATH, PROD_PORT } from "./constants";
import fs from "fs";
import cors from "@fastify/cors";
import path from 'path';

const CHALLENGE_STRINGS = ["Olympic", "Morden", "Ropsten", "Rinkeby", "Kovan", "Goerli"];
interface ChallengeEntry {
  challenge: string;
  timestamp: number;
  ip: string;
}

interface StreamTokenEntry {
  ip: string;
  timestampExpiry: number;
}

type ChainDetail = {
  name: string;
  RPCurl: string;
  chainId: number;
};

let movieName: string = MOVIE_NAME !== undefined ? MOVIE_NAME : fs.readdirSync(path.join(__dirname, '../raw')).find(file => file.endsWith('.mp4'))!;

let productionMode = NODE_ENV === "production";

const CHAIN_DETAILS: Record<number, ChainDetail> = {
  1: {
    name: "mainnet",
    RPCurl: `https://mainnet.infura.io/v3/${INFURA_KEY}`,
    chainId: 1,
  },
  11155111: {
    name: "sepolia",
    RPCurl: `https://sepolia.infura.io/v3/${INFURA_KEY}`,
    chainId: 11155111,
  },
  42161: {
    name: "arbitrum-mainnet",
    RPCurl: `https://arbitrum-mainnet.infura.io/v3/${INFURA_KEY}`,
    chainId: 42161,
  },
  80001: {
    name: "polygon-mumbai",
    RPCurl: `https://polygon-mumbai.infura.io/v3/${INFURA_KEY}`,
    chainId: 80001,
  },
  137: {
    name: "polygon-mainnet",
    RPCurl: `https://polygon-mainnet.infura.io/v3/${INFURA_KEY}`,
    chainId: 137,
  },
  10: {
    name: "optimism-mainnet",
    RPCurl: `https://optimism-mainnet.infura.io/v3/${INFURA_KEY}`,
    chainId: 10,
  },
  8453: {
    name: "base-mainnet",
    RPCurl: `https://base-mainnet.infura.io/v3/${INFURA_KEY}`,
    chainId: 8453,
  },
  84532: {
    name: "base-sepolia",
    RPCurl: `https://base-sepolia.infura.io/v3/${INFURA_KEY}`,
    chainId: 84532,
  },
  17000: {
    name: "holesky",
    RPCurl: `https://holesky.infura.io/v3/${INFURA_KEY}`,
    chainId: 17000,
  },
  59144: {
    name: "linea-mainnet",
    RPCurl: `https://linea-mainnet.infura.io/v3/${INFURA_KEY}`,
    chainId: 59144,
  },
  59145: {
    name: "linea-sepolia",
    RPCurl: `https://linea-sepolia.infura.io/v3/${INFURA_KEY}`,
    chainId: 59145,
  },
};

const challenges: ChallengeEntry[] = [];
//create mapping of streamtoken to IP address
const streamTokens: Record<string, StreamTokenEntry> = {};

const CONTRACT_ADDRESS =
  process.env.CONTRACT_ADDRESS || "0xefAB18061C57C458c52661f50f5b83B600392ed6";  
const CONTRACT_CHAIN_ID = parseInt(process.env.CONTRACT_CHAIN_ID || "8453");

const challengeExpiry = 60 * 60 * 2 * 1000; // 2 hours in milliseconds
const streamTokenExpiry = 60 * 60 * 24 * 1000; // 1 day in milliseconds

async function createServer() {
  let app: FastifyInstance;

  app = fastify({
    maxParamLength: 1024,
    ...(process.env.NODE_ENV === "production"
      ? {
        https: {
          key: fs.readFileSync(`${CERT_PATH}/key.pem`),
          cert: fs.readFileSync(`${CERT_PATH}/cert.pem`)
        }
        }
      : {}),
  });

  await app.register(cors, {
    origin: "*",

  });

  app.get("/challenge", async (request, reply) => {
    //create a challenge string consisting of a random word selected from CHALLENGE_STRINGS followed by a random hex string
    //form a random hex string of length 10 characters
    let challenge =
      CHALLENGE_STRINGS[Math.floor(Math.random() * CHALLENGE_STRINGS.length)] +
      "-" +
      Math.random().toString(36).substring(2, 15);

    const clientIp = request.ip;
    if (!productionMode)console.log("Client IP:", clientIp);  
    challenges.push({ challenge, timestamp: Date.now(), ip: clientIp });
    if (!productionMode) console.log("challenges", challenges);
    return { data: `${challenge}` };
  });

  app.post(`/verify`, async (request, reply) => {
    //recover the address from the signature
    // @ts-ignore
    const { signature, tokenId, token1155Id } = request.body;
    if (!productionMode) console.log("verify", signature, tokenId);
    if (!productionMode) console.log("challenges", challenges);

    const clientIp = request.ip;

    const numericTokenId = parseInt(tokenId);
    if (!productionMode) console.log("numericTokenId", numericTokenId);

    const ownsToken = await checkOwnership(signature, numericTokenId, token1155Id, clientIp);

    if (ownsToken) {
      // generate a random token
      const streamToken = Math.random().toString(36).substring(2, 15);
      streamTokens[streamToken] = { ip: clientIp, timestampExpiry: Date.now() + streamTokenExpiry };
      if (!productionMode) console.log("streamToken: ", streamToken);
      return { data: `pass`, token: `${streamToken}` }
    } else {
      return reply.status(500).send({ data: `signature not valid`});
    }

  });

  app.get('/stream/:streamtoken', async (request, reply) => {
    const filePath = path.join(__dirname, '../raw', movieName);
    if (!productionMode) console.log("filePath", filePath);
    // @ts-ignore
    const { streamtoken } = request.params;
    if (!productionMode) console.log("streamtoken", streamtoken);

    // Check if file exists and stream token is valid
    if (fs.existsSync(filePath) && streamTokens[streamtoken] && streamTokens[streamtoken].ip === request.ip && streamTokens[streamtoken].timestampExpiry >= Date.now()) {
      reply.header('Content-Disposition', `attachment; filename=${movieName}`);
      reply.header('Content-Type', 'video/mp4');
      return reply.send(fs.createReadStream(filePath));
    } else {
      removeStreamTokens();
      return reply.status(404).send({ status: 'File not found' });
    }
  });

  function removeStreamTokens() {
    for (const token in streamTokens) {
      if (streamTokens[token].timestampExpiry < Date.now()) {
        delete streamTokens[token];
      }
    }
  }

  console.log("Returning app from function");
  return app;
}



function getProvider(useChainId: number): ethers.JsonRpcProvider | null {
  console.log("getProvider useChainId", useChainId);
  const chainDetails: ChainDetail = CHAIN_DETAILS[useChainId];

  if (chainDetails !== null) {
    return new ethers.JsonRpcProvider(chainDetails.RPCurl, {
      chainId: chainDetails.chainId,
      name: chainDetails.name,
    });
  } else {
    return null;
  }
}

async function checkOwnership(
  signature: string,
  tokenId: number | undefined,
  token1155Id: number | undefined,
  clientIp: string
): Promise<boolean> {
  //loop through all of the challenge strings which are still valid

  //console.log(`tokenOwner ${tokenOwner} tokenID ${tokenId} Sender: ${clientIp}`);
  if (!productionMode) console.log("challenges tokenOwner", challenges);

  for (let i = 0; i < challenges.length; i++) {
    const thisChallenge = challenges[i];
    if (!productionMode) console.log(
      "thisChallenge",
      thisChallenge,
      thisChallenge.timestamp + challengeExpiry > Date.now()
    );
    if (!productionMode) console.log(`thisChallengeIP: ${thisChallenge.ip} clientIp: ${clientIp}`);
    if (thisChallenge.timestamp + challengeExpiry >= Date.now() && thisChallenge.ip === clientIp) {
      //recover the address
      const address = ethers.verifyMessage(
        thisChallenge.challenge,
        addHexPrefix(signature)
      );

      let isOwner = false;
      let tokenOwner = "-";
      if (token1155Id !== undefined) {
        if (!productionMode) console.log("tokenId is undefined or NaN");
        // check owner of token
        isOwner = await is1155TokenOwner(address, token1155Id);
      } else if (tokenId !== undefined && !Number.isNaN(tokenId)) {
        tokenOwner = await getTokenOwner(tokenId);
      } else {
        //check balance of ERC-721 if required
      }

      if (!productionMode) console.log("address", address);
      if (!productionMode) console.log("tokenOwner", tokenOwner);
      if (!productionMode) console.log("isOwner", isOwner);

      if (isOwner || address.toLowerCase() === tokenOwner.toLowerCase()) {
        console.log("PASS!");
        //if the address matches the token owner, return true
        //remove entry from challenges
        challenges.splice(i, 1);
        return true;
      }
    } else if (thisChallenge.timestamp + challengeExpiry < Date.now()) {
      //remove expired entry
      challenges.splice(i, 1);
      //begin from start again
      i = 0;
    }
  }

  return false;
}

async function is1155TokenOwner(address: string, tokenId: number): Promise<boolean> {
  console.log("isTokenOwner", address);
  const provider = getProvider(CONTRACT_CHAIN_ID);
  if (!productionMode) console.log("provider", provider);

  const queryContract = new ethers.Contract(
    CONTRACT_ADDRESS,
    ["function balanceOf(address owner, uint256 tokenId) public view returns (uint256)"],
    provider
  );

  try {
    if (!productionMode) console.log("queryContract", queryContract);
    const balance = await queryContract.balanceOf(address, tokenId);
    if (!productionMode) console.log("balance", balance);
    return balance > 0;
  } catch (e) {
    console.log("error", e);
    return false;
  }
}

async function getTokenOwner(tokenId: number): Promise<string> {
  console.log("getTokenOwner", tokenId);
  const provider = getProvider(CONTRACT_CHAIN_ID);
  if (!productionMode) console.log("provider", provider);

  const queryContract = new ethers.Contract(
    CONTRACT_ADDRESS,
    ["function ownerOf(uint256 tokenId) view returns (address)"],
    provider
  );

  if (!productionMode) console.log("queryContract", queryContract);
  try {
    return await queryContract.ownerOf(tokenId);
  } catch (e) {
    console.log("error", e);
    return "";
  }
}

function addHexPrefix(hex: string): string {
  if (hex.startsWith("0x")) {
    return hex;
  } else {
    return "0x" + hex;
  }
}

const start = async () => {
  try {
    const app = await createServer();

    console.log("NODE_ENV", NODE_ENV);

    const host = "0.0.0.0";
    const port = productionMode ? Number(PROD_PORT) : 8082;
    await app.listen({ port, host });
    console.log(`Server is listening on ${host} ${port}`);

  } catch (err) {
    console.log(err);
    process.exit(1);
  }
};

start();
