// SPDX-License-Identifier: MIT

pragma solidity ^0.7.0;
pragma experimental ABIEncoderV2;

import "../../interfaces/IDSProxy.sol";
import "../../exchangeV3/DFSExchangeCore.sol";
import "../../utils/GasBurner.sol";
import "../ActionBase.sol";

/// @title A exchange sell action through the dfs exchange
contract DFSBuy is ActionBase, DFSExchangeCore, GasBurner {
    uint256 internal constant RECIPIE_FEE = 400;
    uint256 internal constant DIRECT_FEE = 800;

    /// @inheritdoc ActionBase
    function executeAction(
        bytes[] memory _callData,
        bytes[] memory _subData,
        uint8[] memory _paramMapping,
        bytes32[] memory _returnValues
    ) public payable override returns (bytes32) {
        (ExchangeData memory exchangeData, address from, address to) = parseInputs(_callData);

        exchangeData.srcAddr = _parseParamAddr(
            exchangeData.srcAddr,
            _paramMapping[0],
            _subData,
            _returnValues
        );
        exchangeData.destAddr = _parseParamAddr(
            exchangeData.destAddr,
            _paramMapping[1],
            _subData,
            _returnValues
        );

        exchangeData.destAmount = _parseParamUint(
            exchangeData.destAmount,
            _paramMapping[2],
            _subData,
            _returnValues
        );
        from = _parseParamAddr(from, _paramMapping[3], _subData, _returnValues);
        to = _parseParamAddr(to, _paramMapping[4], _subData, _returnValues);

        uint256 exchangedAmount = _dfsBuy(exchangeData, from, to, RECIPIE_FEE);

        return bytes32(exchangedAmount);
    }

    /// @inheritdoc ActionBase
    function executeActionDirect(bytes[] memory _callData) public payable override burnGas {
        (ExchangeData memory exchangeData, address from, address to) = parseInputs(_callData);

        _dfsBuy(exchangeData, from, to, DIRECT_FEE);
    }

    /// @inheritdoc ActionBase
    function actionType() public pure override returns (uint8) {
        return uint8(ActionType.STANDARD_ACTION);
    }

    //////////////////////////// ACTION LOGIC ////////////////////////////

    function _dfsBuy(
        ExchangeData memory exchangeData,
        address _from,
        address _to,
        uint256 _fee
    ) internal returns (uint256) {
        pullTokens(exchangeData.srcAddr, _from, exchangeData.srcAmount);

        uint256 balanceBefore =
            getBalance(exchangeData.srcAddr, address(this)) - exchangeData.srcAmount;

        exchangeData.user = getUserAddress();
        exchangeData.dfsFeeDivider = _fee;

        (address wrapper, uint256 amountSold) = _buy(exchangeData);

        withdrawTokens(exchangeData.destAddr, _to, exchangeData.destAmount);

        withdrawTokens(
            exchangeData.srcAddr,
            _from,
            getBalance(exchangeData.srcAddr, address(this)) - balanceBefore
        );

        logger.Log(
            address(this),
            msg.sender,
            "DfsBuy",
            abi.encode(
                wrapper,
                exchangeData.srcAddr,
                exchangeData.destAddr,
                amountSold,
                exchangeData.destAmount
            )
        );

        return amountSold;
    }

    function parseInputs(bytes[] memory _callData)
        public
        pure
        returns (
            ExchangeData memory exchangeData,
            address from,
            address to
        )
    {
        exchangeData = unpackExchangeData(_callData[0]);

        from = abi.decode(_callData[1], (address));
        to = abi.decode(_callData[2], (address));
    }

    /// @notice Returns the owner of the DSProxy that called the contract
    function getUserAddress() internal view returns (address) {
        IDSProxy proxy = IDSProxy(payable(address(this)));

        return proxy.owner();
    }
}