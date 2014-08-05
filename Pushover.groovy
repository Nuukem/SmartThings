// Basic section
section("Send the alert through Pushover (optional but removes standard push notification)"){
        input "apiKey", "text", title: "Pushover API Key", required: false
        input "userGroupKey", "text", title: "Pushover User/Group Key", required: false
        input "usePushover", "enum", title: "Use Pushover?", required: true, metadata: [values: [ 'Yes','No' ] ]
		input "poTitle", "text", title: "Pushover Title", required: false
        input "deviceName", "text", title: "Pushover Device Name(s) (comma delimited)", required: false
        input "priority", "enum", title: "Pushover Priority", required: false,
        metadata :[
           values: [ 'Low', 'Normal', 'High', 'Emergency'
           ]
        ]
    }

// Enhanced section with sounds.    
section("Send the alert through Pushover (optional but removes standard push notification)"){
        input "apiKey", "text", title: "Pushover API Key", required: true
        input "userGroupKey", "text", title: "Pushover User/Group Key", required: true
        input "usePushover", "enum", title: "Use Pushover?", required: true, metadata: [values: [ 'Yes','No' ] ]
		input "poTitle", "text", title: "Message Title", required: false
        input "deviceName", "text", title: "Pushover Device Name(s) (comma delimited)", required: false
        input "priority", "enum", title: "Pushover Priority (default is Normal)", required: false,
        metadata :[
           values: [ 'Low', 'Normal', 'High', 'Emergency' ]
        ]
        input "sound", "enum", title: "Pushover Sound", required: false,
        metadata :[
           values: [ 'pushover','bike','bugle','cashregister','classical','cosmic','falling','gamelan','incoming','intermission','magic','mechanical','pianobar','siren','spacealarm','tugboat','alien','climb','persistent','echo','updown','none']
        ]
    }
    




def sendMessage(msg,pri) {
	
    def priority = pri
    //def apiKey = could hard code your apiKey here
    //def userKey = could hard code your userKey here

    log.debug "msg = $msg"
    
    if (phone) { // only needed it allowing SMS notification also
		sendSms(phone, "$msg")
    }
    
    if(usePushover == "Yes") { // Using Pushover API
     
      log.debug "Sending Pushover with API Key [$apiKey] and User Key [$userKey]"
      
      def postBody = []
      def pushPriority = 0
      
      // Set Priority for Pushover Notification
      if(priority == "Low")
      {
        pushPriority = -1
      }
      else if(priority == "Normal")
      {
        pushPriority = 0
      }
      else if(priority == "High")
      {
        pushPriority = 1
      }
      else if(priority == "Emergency")
      {
        pushPriority = 2
      }
      
      if(deviceName) // eventually, want to loop over device list.
      {
        log.debug "Sending Pushover to Device: $deviceName"
        
        if(pushPriority == 2)
        {
          postBody = [token: "$apiKey", user: "$userGroupKey", device: "$deviceName", title: "$poTitle", message: "$msg", priority: "$pushPriority", retry: "120", expire: "1800"]
        }
        else
        {
          postBody = [token: "$apiKey", user: "$userGroupKey", device: "$deviceName", title: "$poTitle", message: "$msg", priority: "$pushPriority"]
        }
        
        log.debug postBody
      }
      else
      {
        log.debug "Sending Pushover to All Devices"
        
        if(pushPriority == 2)
        {
          postBody = [token: "$apiKey", user: "$userGroupKey", title: "$poTitle", message: "$msg", priority: "$pushPriority", retry: "120", expire: "1800"]
        }
        else
        {
          postBody = [token: "$apiKey", user: "$userGroupKey", title: "$poTitle", message: "$msg", priority: "$pushPriority"]
        }
        
        log.debug "postBody = ${postBody}"
      }
      
      def params = [
      		uri: 'https://api.pushover.net/1/messages.json',
            body: postBody
            ]
      
      httpPost(params){ response ->
          log.debug "Response Received: Status [$response.status]"
          
          if(response.status != 200)
          {
            sendPush("Notify Me (Pushover): Received Pushover HTTP Error Response. Check Install Parameters.")
          }
      }
    } 
	else 
	{// not using Pushover so send via regular push notification
        log.debug "Sending push"
		sendPush(msg)
	}
}


