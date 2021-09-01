// Copyright 2018 Google LLC
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     https://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

const express = require('express');
const router = express.Router();

const PubSub = require('@google-cloud/pubsub');

// location of service account credentials file
const privateKeyFile
    = '../resources/rbm-agent-service-account-credentials.json';

// service account credentials for Pub/Sub
const privatekey = require(privateKeyFile);

// the name of the Pub/Sub pull subscription,
// replace with your subscription name
const subscriptionName = 'rbm-agent-subscription';

// reference to RBM API helper
const rbmApiHelper = require('../libs/rbm_api_helper');

// initialize Pub/Sub for pull subscription listener
// this is how this agent will receive messages from the client
initPubsub();

/**
 * Invites the device phone number as a tester for this agent.
 */
router.get('/register', function(req, res, next) {
    // get the phone number value
    let phoneNumber = req.query.phone_number;

    // send the passed in phone number a tester invite
    rbmApiHelper.sendTesterInvite(phoneNumber, function() {
        res.json({'result': 'ok'});
    });
});

/**
 * Sends the user a marketing message for a deal on pizza.
 */
router.get('/startConversation', function(req, res, next) {
    // get the phone number value
    let phoneNumber = req.query.phone_number;

    let welcomeText = 'Welcome to Acme Pizza promotions.\n\n' + 
        'Check out today\'s promotional offer!';
        
    rbmApiHelper.sendMessage(welcomeText, null, phoneNumber,
        function(response) {
            sendOffer(phoneNumber, function(response) {
                // message was sent successfully
                if (response == null) {
                    res.json({'result': 'ok'});
                }

                res.json({'result': 'fail'});
            });
        });
});

/**
 * Launch page for Acme Pizza marketing demo.
 */
router.get('/', function(req, res, next) {
    let message = '';

    if (req.query.message) {
        message = req.query.message;
    }

    res.render('index', {title: 'Acme Pizza Demo Agent', message: message});
});


/**
 * Sends the client the initial marketing offer.
 * @param {string} msisdn The phone number in E.164 format.
 * @param {function} callback Callback method for after
 */
function sendOffer(msisdn, callback) {
    // URL to an image of the coupon
    let pizzaUrl = 'https://firebasestorage.googleapis.com/v0/b/rbm-nodejs-acme-pizza.appspot.com/o/pizza-ad-coupon.png?alt=media&token=b2f844c7-3445-43e3-8f69-096e64fde4f2';

    // title of the rich card
    let messageText = 'Buy Any 12 Inch Pizza and Get One FREE!';

    // description of the offer of the offer for the rich card
    let messageDescription = 'Show this message at any participating ' +
        'Acme Pizza location to redeem this offer. Offer expires 2/17.' +
        '\n\nType STOP to cancel these offers.';

    // create a suggested action to direct the client to view the menu
    let suggestions = [
                {
                    action: {
                        text: 'View Pizza Menu',
                        postbackData: 'view_details',
                        openUrlAction: {
                            url: 'https://firebasestorage.googleapis.com/v0/b/rbm-nodejs-acme-pizza.appspot.com/o/pizza-menu.png?alt=media&token=07c9192f-6f3a-47e2-a710-1e2099a78fbb',
                        },
                    },
                },
            ];

    // initialize the conversation
    rbmApiHelper.sendRichCard(messageText, messageDescription, suggestions,
        pizzaUrl, msisdn, function(response) {
            if (callback != null) {
                callback(response);
            }
        });
}

/**
 * Parses the userEvent object to get the response body.
 * This can be plaintext or part of a suggested response.
 * @param {object} userEvent The JSON object of a message
 * received by the pull subscription.
 * @return {string} The body of the message, false if not found.
 */
function getMessageBody(userEvent) {
    if (userEvent.text != undefined) {
        return userEvent.text;
    } else if (userEvent.suggestionResponse != undefined) {
        return userEvent.suggestionResponse.postbackData;
    }

    return false;
}

/**
 * Uses the event received by the pull subscription to send a
 * response to the client's device.
 * @param {object} userEvent The JSON object of a message
 * received by the pull subscription.
 */
function handleMessage(userEvent) {
    if (userEvent.senderPhoneNumber != undefined) {
        // get the sender's phone number
        let msisdn = userEvent.senderPhoneNumber;

        // parse the response text
        let message = getMessageBody(userEvent);

        // get the message id
        let messageId = userEvent.messageId;

        // check to see that we have a message to process
        if (message) {
            // send a read receipt
            rbmApiHelper.sendReadMessage(msisdn, messageId);

            if (message.toUpperCase() == 'STOP') {
                // let the user know we are typing
                rbmApiHelper.sendIsTypingMessage(msisdn);

                // let the user know we will stop sending promotions
                rbmApiHelper.sendMessage('No problem. You will no longer ' +
                    'receive these promotions.', null, msisdn);
            } else if (message != 'view_details') {
                // let the user know we are typing
                rbmApiHelper.sendIsTypingMessage(msisdn);

                // re-send the offer
                sendOffer(msisdn);
            }
        }
    }
}

/**
 * Initializes a pull subscription message handler
 * to receive messages from Pub/Sub.
 */
function initPubsub() {
    let pubsub = new PubSub({
        projectId: privatekey.project_id,
        keyFilename: './resources/rbm-agent-service-account-credentials.json',
    });

    // references an existing subscription
    const subscription = pubsub.subscription(subscriptionName);

    // create an event handler to handle messages
    const messageHandler = (message) => {
        console.log(`Received message ${message.id}:`);
        console.log(`\tData: ${message.data}`);
        console.log(`\tAttributes: ${message.attributes}`);

        let userEvent = JSON.parse(message.data);

        handleMessage(userEvent);

        // "Ack" (acknowledge receipt of) the message
        message.ack();
    };

    // Listen for new messages until timeout is hit
    subscription.on('message', messageHandler);
}

module.exports = router;
