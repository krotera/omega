import React, { useState } from "react";
import {
  Account,
  PublicKey,
  sendAndConfirmRawTransaction,
  SystemProgram,
  Transaction,
  TransactionInstruction,
} from '@solana/web3.js';
import {AccountLayout} from '@solana/spl-token';
import BufferLayout from 'buffer-layout';
import { TokenInstructions } from '@project-serum/serum';
import { Button, Popover, Col, Row, Card } from "antd";
import { SettingOutlined } from "@ant-design/icons";

import { NumericInput } from "./numericInput";
import { Settings } from "./settings";
import { AppBar } from "./appBar";
import { CurrencyPairProvider, useCurrencyPairState } from "../utils/currencyPair";
import { SwapView } from "./swap";
import contract_keys from "../contract_keys.json";
import { markets } from "../markets";
import { PoolConfig } from "../models";
import { DEFAULT_DENOMINATOR } from "./pool/config";
import { useConnection, useSlippageConfig } from '../utils/connection';
import { useWallet } from '../utils/wallet';
import { useMint } from '../utils/accounts';
import { sendTransaction } from "../utils/utils";
import { addLiquidity, usePoolForBasket } from "../utils/pools";
import { notify } from "../utils/notifications";

export const ExchangeView = (props: {}) => {
  const PROGRAM_ID = new PublicKey(contract_keys.omega_program_id);

  console.log('PROGRAM_ID', PROGRAM_ID.toString());

  const QUOTE_CURRENCY = "USDC";
  const QUOTE_CURRENCY_MINT = new PublicKey(contract_keys.quote_mint_pk);

  console.log('QUOTE_CURRENCY', QUOTE_CURRENCY, QUOTE_CURRENCY_MINT.toString());

  markets.forEach(m => {
    console.log('MARKET', m.contract_name);
  });

  const { wallet, connected } = useWallet();
  const connection = useConnection();
  const [pendingTx, setPendingTx] = useState(false);
  const {
    A,
    B,
    setLastTypedAccount,
    setPoolOperation,
  } = useCurrencyPairState();
  const pool = usePoolForBasket([A?.mintAddress, B?.mintAddress]);
  const { slippage } = useSlippageConfig();
  const [options, setOptions] = useState<PoolConfig>({
    curveType: 0,
    tradeFeeNumerator: 25,
    tradeFeeDenominator: DEFAULT_DENOMINATOR,
    ownerTradeFeeNumerator: 5,
    ownerTradeFeeDenominator: DEFAULT_DENOMINATOR,
    ownerWithdrawFeeNumerator: 0,
    ownerWithdrawFeeDenominator: DEFAULT_DENOMINATOR,
  });
  const tokensAndUSDCToPool = !connected
      ? wallet.connect
      : async () => {
          if (A.account && B.account && A.mint && B.mint) {
            setPendingTx(true);
            const components = [
              {
                account: A.account,
                mintAddress: A.mintAddress,
                amount: A.convertAmount(),
              },
              {
                account: B.account,
                mintAddress: B.mintAddress,
                amount: B.convertAmount(),
              },
            ];

            addLiquidity(connection, wallet, components, slippage, pool, options)
              .then(() => {
                setPendingTx(false);
              })
              .catch((e) => {
                console.log("Transaction failed", e);
                notify({
                  description:
                    "Please try again and approve transactions from your wallet",
                  message: "Adding liquidity cancelled.",
                  type: "error",
                });
                setPendingTx(false);
              });
          }
        };
  const colStyle: React.CSSProperties = { padding: "1em" };

  // Stuff for the Provide Liquidity card
  //
  // NOTE:
  // This was all moved over from omega/ui/src/components/redeem.jsx,
  // so it's JavaScript-forced-into-TypeScript.
  // One side effect of this is the gnarly function parameter type annotations
  // (in JS, they can be unannotated, while TS complains with error "ts(7006)").
  const quoteMint = useMint(contract_keys.quote_mint_pk);
  const [contractData, setContractData] = useState({
    exp_time: 1612137600, // 02/01/2021 00:00 UTC
    decided: false
  });

  const IC_ISSUE_SET = 1;
  const IC_REDEEM_SET = 2;
  const IC_REDEEM_WINNER = 3;

  const instructionLayout = BufferLayout.struct([
    BufferLayout.u32('instruction'),
    BufferLayout.nu64('quantity'),
  ]);

  const [issueMarket, setIssueMarket] = useState(markets[0]);
  const [issueAmount, setIssueAmount] = useState("");

  function encodeInstructionData(layout: { encode: (arg0: any, arg1: Buffer) => any; }, args: { instruction: number; quantity: any; }) {
    let data = Buffer.alloc(1024);
    const encodeLength = layout.encode(args, data);
    return data.slice(0, encodeLength);
  }

  function IssueSetInstruction(omegaContract: PublicKey, user: any, userQuote: any, vault: PublicKey, omegaSigner: PublicKey, outcomePks: string | any[], quantity: any) {
    let keys = [
      { pubkey: omegaContract, isSigner: false, isWritable: false },
      { pubkey: user, isSigner: true, isWritable: false },
      { pubkey: userQuote, isSigner: false, isWritable: true },
      { pubkey: vault, isSigner: false, isWritable: true },
      { pubkey: TokenInstructions.TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: omegaSigner, isSigner: false, isWritable: false }
    ];
  
    for (var i = 0; i < outcomePks.length; i++) {
      keys.push({pubkey: outcomePks[i], isSigner: false, isWritable: true});
    }
  
    const data = encodeInstructionData(instructionLayout, {
      instruction: IC_ISSUE_SET,
      quantity
    });
  
    return new TransactionInstruction({keys: keys, programId: PROGRAM_ID, data: data});
  }

  async function fetchAccounts() {
    console.log('Fetch all SPL tokens for', wallet.publicKey.toString());

    const response = await connection.getParsedTokenAccountsByOwner(
      wallet.publicKey,
      { programId: TokenInstructions.TOKEN_PROGRAM_ID }
    );

    console.log(response.value.length, 'SPL tokens found', response);

    response.value.map((a) => a.account.data.parsed.info).forEach((info, _) => {
      console.log(info.mint, info.tokenAmount.uiAmount);
    });

    return response.value;
  }

  async function createTokenAccountTransaction(mintPubkey: any) {
    const newAccount = new Account();
    const transaction = new Transaction();
    transaction.add(
      SystemProgram.createAccount({
        fromPubkey: wallet.publicKey,
        newAccountPubkey: newAccount.publicKey,
        lamports: await connection.getMinimumBalanceForRentExemption(AccountLayout.span),
        space: AccountLayout.span,
        programId: TokenInstructions.TOKEN_PROGRAM_ID,
      })
    );

    transaction.add(
      TokenInstructions.initializeAccount({
        account: newAccount.publicKey,
        mint: mintPubkey,
        owner: wallet.publicKey,
      }),
    );

    return {
      transaction,
      signer: newAccount,
      newAccountPubkey: newAccount.publicKey,
    };
  }

  async function userTokenAccount(accounts: any[], mintPubkey: PublicKey) {
    let account = accounts.find((a: { account: { data: { parsed: { info: { mint: any; }; }; }; }; }) => a.account.data.parsed.info.mint === mintPubkey.toBase58())
    if (account) {
      console.log('account exists', mintPubkey.toString(), account.pubkey.toString());
      return account.pubkey;
    } else {
      console.log('creating new account for', mintPubkey.toString());
      let { transaction, signer, newAccountPubkey } = await createTokenAccountTransaction(mintPubkey);

      let signers = [signer]

      const instrStr = 'create account'
      let txid = await sendTransaction({
        transaction,
        wallet,
        signers,
        connection,
        sendingMessage: `sending ${instrStr}...`,
        sentMessage: `${instrStr} sent`,
        successMessage: `${instrStr} success`
      });
      console.log("txid", txid);
      console.log('pubkey', newAccountPubkey.toString());

      return newAccountPubkey;
    }
  }

  function parseAmount(amount: string) {
    if (quoteMint) { // null check to handle JS-to-TS error "ts(2532)"
      return parseFloat(amount) * Math.pow(10, quoteMint.decimals);
    }
    else {
      console.error("FATAL ERROR: quoteMint was null!");
      return null;
    }
  }
  
  async function issueSet(market: { [x: string]: any; contract_name?: string; details?: string; omega_contract_pk: any; omega_program_id?: string; oracle_pk?: string; outcomes?: { icon: string; mint_pk: string; name: string; }[]; quote_mint_pk?: string; quote_vault_pk: any; signer_nonce?: number; signer_pk: any; }, amount: number | null) {
    if (!wallet.connected) await wallet.connect();
    console.log('issueSet', amount);

    const accounts = await fetchAccounts();

    let userQuote = await userTokenAccount(accounts, QUOTE_CURRENCY_MINT);
    let outcomePks = [];
    let outcomeInfos = market["outcomes"];

    if (!outcomeInfos) { // null check to handle JS-to-TS error "ts(2532)"
      console.error("FATAL ERROR: outcomeInfos was null!");
      return null;
    }

    let numOutcomes = outcomeInfos.length;
    for (let i = 0; i < numOutcomes; i++) {
      let outcomeMint = new PublicKey(outcomeInfos[i]["mint_pk"]);
      outcomePks.push(outcomeMint);
      let userOutcomeWallet = await userTokenAccount(accounts, outcomeMint);
      outcomePks.push(userOutcomeWallet);
      console.log(outcomeInfos[i]["name"], outcomeMint, userOutcomeWallet);
    }
    let issueSetInstruction = IssueSetInstruction(
      new PublicKey(market.omega_contract_pk),
      wallet.publicKey,
      userQuote,
      new PublicKey(market.quote_vault_pk),
      new PublicKey(market.signer_pk),
      outcomePks,
      amount);
    let transaction = new Transaction();
    transaction.add(issueSetInstruction);

    let txid = await sendTransaction({
      transaction,
      wallet,
      signers: [],
      connection,
      sendingMessage: 'sending IssueSetInstruction...',
      sentMessage: 'IssueSetInstruction sent',
      successMessage: 'IssueSetInstruction success'
    });
    console.log('success txid:', txid);
  }

  // Provide liquidity to the pool, doing the following:
  //     1. Convert `x` USDC into `x` of each type of token
  //     2. Fund the pool with all `x` of each token and `x * price` USDC given
  //        the `price` of that type of token
  async function provideLiquidity(
    market: { [x: string]: any; contract_name?: string; details?: string; omega_contract_pk: any; omega_program_id?: string; oracle_pk?: string; outcomes?: { icon: string; mint_pk: string; name: string; }[]; quote_mint_pk?: string; quote_vault_pk: any; signer_nonce?: number; signer_pk: any; }, 
    amount: number | null
  ) {
    await issueSet(market, amount); // step 1

    // inbetween here, configure A and B...

    await tokensAndUSDCToPool(); // step 2
  }

  return (
    <>
      <AppBar
        right={
          <Popover
            placement="topRight"
            title="Settings"
            content={<Settings />}
            trigger="click"
          >
            <Button
              shape="circle"
              size="large"
              type="text"
              icon={<SettingOutlined />}
            />
          </Popover>
        }
      />

      { markets.map((market: any) =>
        <>
          {/* Provide Liquidity card */}
          <Row justify="center">
            <div style={colStyle}>
                <CurrencyPairProvider baseMintAddress={market.quote_mint_pk}
                                      quoteMintAddress={market.outcomes[0].mint_pk} >
                <Card>
                  <h2>Provide Liquidity</h2>
                  <p>Swap USDC for equal quantities of {issueMarket.contract_name} tokens that are automatically added to the pool.</p>
                  <NumericInput
                    value={issueAmount}
                    onChange={setIssueAmount}
                    style={{
                      "margin-bottom": 10,
                    }}
                    addonAfter="USDC"
                    placeholder="0.00"
                  />
                  <Button
                    className="trade-button"
                    type="primary"
                    onClick={connected ? () => provideLiquidity(issueMarket, parseAmount(issueAmount)) : wallet.connect}
                    style={{ width: "100%" }}
                  >
                    { connected ? "Issue Tokens" : "Connect Wallet" }

                  </Button>
                  <br/><br/>
                  <Popover
                    trigger="hover"
                    content={
                      <div style={{ width: 300 }}>
                        Liquidity providers earn a fixed percentage fee on all trades
                        proportional to their share of the pool. Fees are added to the
                        pool, accrue in real time and can be claimed by withdrawing your
                        liquidity.
                      </div>
                    }
                  >
                    <Button type="text">Read more about providing liquidity.</Button>
                  </Popover>
                </Card>
              </CurrencyPairProvider>
            </div>
          </Row>

          {/* Trade / Pool elements */}
          <Row justify="center">
          <Col flex={2}>
            <div style={colStyle}>
              <CurrencyPairProvider baseMintAddress={market.quote_mint_pk}
                                    quoteMintAddress={market.outcomes[0].mint_pk} >
                <SwapView />
              </CurrencyPairProvider>
            </div>
          </Col>
          <Col flex={2}>
            <div style={colStyle}>
              <CurrencyPairProvider baseMintAddress={market.quote_mint_pk}
                                    quoteMintAddress={market.outcomes[1].mint_pk} >
                <SwapView />
              </CurrencyPairProvider>
            </div>
          </Col>
          </Row>
        </>
      )}
    </>
  );
};