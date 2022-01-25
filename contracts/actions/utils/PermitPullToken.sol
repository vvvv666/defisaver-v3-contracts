// SPDX-License-Identifier: MIT

pragma solidity =0.7.6;
pragma experimental ABIEncoderV2;

import "../../utils/TokenUtils.sol";
import "../ActionBase.sol";

import "../../interfaces/IERC20WithPermit.sol";

/// @title Helper action to pull a token from the specified address without the need for approval tx beforehand
/// @notice only available for tokens that implement permit function (EIP2612)
/// @notice only available where the address from which we pull tokens is EOA
contract PermitPullToken is ActionBase {

    address public constant DAI_ADDR = 0x6B175474E89094C44Da98b954EedeAC495271d0F;

    using TokenUtils for address;

    /// @param tokenAddr address of the token to pull
    /// @param from address from which we're pulling the token (must be EOA)
    /// @param amount amound of tokens we're pulling to proxy
    /// @param deadline timestamp until which approval is valid
    /// @param v part of ECDSA signature
    /// @param r part of ECDSA signature
    /// @param s part of ECDSA signature
    struct Params {
        address tokenAddr;
        address from;
        uint256 amount;
        uint256 deadline;
        uint8 v;
        bytes32 r;
        bytes32 s;
    }

    /// @inheritdoc ActionBase
    function executeAction(
        bytes[] memory _callData,
        bytes[] memory _subData,
        uint8[] memory _paramMapping,
        bytes32[] memory _returnValues
    ) public payable virtual override returns (bytes32) {
        Params memory params = parseInputs(_callData);

        uint256 amountPulled = _pullToken(params);

        return bytes32(amountPulled);
    }

    /// @inheritdoc ActionBase
    function executeActionDirect(bytes[] memory _callData) public payable override {
        Params memory params = parseInputs(_callData);

        _pullToken(params);
    }

    /// @inheritdoc ActionBase
    function actionType() public pure virtual override returns (uint8) {
        return uint8(ActionType.STANDARD_ACTION);
    }

    //////////////////////////// ACTION LOGIC ////////////////////////////

    /// @notice Pulls a token from the specified addr, doesn't work with ETH
    /// @dev If amount is type(uint).max it will send _inputData.from token balance
    /// @dev If tokenAddr is DAI it will use different type of permit
    function _pullToken(Params memory _inputParams) internal returns (uint256 amountPulled) {
        
        if (_inputParams.tokenAddr == DAI_ADDR) {
            uint256 nonce = IERC20WithPermit(DAI_ADDR).nonces(_inputParams.from);
            IERC20WithPermit(DAI_ADDR).permit(
                _inputParams.from,
                address(this),
                nonce,
                _inputParams.deadline,
                true,
                _inputParams.v,
                _inputParams.r,
                _inputParams.s
            );
        } else {
            IERC20WithPermit(_inputParams.tokenAddr).permit(
                _inputParams.from,
                address(this),
                _inputParams.amount,
                _inputParams.deadline,
                _inputParams.v,
                _inputParams.r,
                _inputParams.s
            );
        }
        amountPulled = _inputParams.tokenAddr.pullTokensIfNeeded(
            _inputParams.from,
            _inputParams.amount
        );
    }

    function parseInputs(bytes[] memory _callData) internal pure returns (Params memory params) {
        params = abi.decode(_callData[0], (Params));
    }
}
