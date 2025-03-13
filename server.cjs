require('dotenv').config()
const { getJson } = require("serpapi");
const { createServer } = require('node:http');
const axios = require("axios");
const AWS = require("aws-sdk");

const port = process.env.PORT || 3001;

const serpApiKey = process.env.SERPAPI_API_KEY;
const googleMapsKey = process.env.GOOGLE_MAPS_API_KEY;
const s3 = new AWS.S3({
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  region: process.env.AWS_REGION,
});
const openAIKey = process.env.OPENAI_API_KEY;

const server = createServer(async (req, res) => {
  
  const method = req.method.toUpperCase();

  const allowed_domains = [
    "http://localhost:5173",
    "https://travelaid.onrender.com"
  ];
  const origin = req.headers.origin;
  if (allowed_domains.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
  }
  res.setHeader("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  const url = new URL(req.url, `http://${req.headers.host}`);
  const path = url.pathname;
  const searchParams = url.searchParams;

  if (path === "/generate-image" && method === "POST") {
    let title = "";
    
    req.on("data", (chunk) => {
      const body = JSON.parse(chunk.toString());
      title = body.title;
    });
    
    req.on("end", async () => {
      try {
        const response = await axios.post("https://api.openai.com/v1/images/generations",
        {
          model: "dall-e-3",
          prompt: `Create an image of a logo for ${title} use the text exactly like: "${title}"`,
          n: 1,
          response_format: "b64_json"
        },
        {
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${openAIKey}`,
          },
        });
        const base64String = response.data.data[0].b64_json;

        res.statusCode = 200;
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ base64Image: base64String }));
      } catch (error) {
        console.error("Upload error:", error);
        res.statusCode = 500;
        res.end(JSON.stringify({ error: "Image upload failed" }));
      }
    })
  } else if (path === "/upload-image" && method === "POST") {
    let body = "";
    
    req.on("data", (chunk) => {
      body += chunk.toString();
    });
    
    req.on("end", async () => {
      try {
        const { imageBinary, fileName } = JSON.parse(body);

        if (!imageBinary || !fileName) {
          res.statusCode = 400;
          res.end(JSON.stringify({ error: "Missing imageBinary or fileName" }));
          return;
        }

        const buf = Buffer.from(imageBinary.replace(/^data:image\/\w+;base64,/, ""), "base64");

        const params = {
          Bucket: process.env.AWS_BUCKET_NAME,
          Key: fileName,
          Body: buf,
          ContentEncoding: "base64",
          ContentType: "image/png",
        };

        const uploadResult = await s3.upload(params).promise();

        res.statusCode = 200;
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ url: uploadResult.Location }));
      } catch (error) {
        console.error("Upload error:", error);
        res.statusCode = 500;
        res.end(JSON.stringify({ error: "Image upload failed" }));
      }
    });
    return;
  } else if (path === "/search-flights" && method === "GET") {
    const engine = searchParams.get("engine");
    const departure_id = searchParams.get("departure_id");
    const arrival_id = searchParams.get("arrival_id");
    const outbound_date = searchParams.get("outbound_date");
    const return_date = searchParams.get("return_date");
    const departure_token = searchParams.get("departure_token");
    const booking_token = searchParams.get("booking_token");

    try {
      const response = await getJson({
        api_key: serpApiKey,
        engine: engine,
        hl: "en",
        gl: "us",
        departure_id: departure_id,
        arrival_id: arrival_id,
        outbound_date: outbound_date,
        return_date: return_date,
        currency: "USD",
        departure_token: departure_token,
        booking_token: booking_token,
      });

      res.statusCode = 200;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify(response));
    } catch (error) {
      console.log("ERROR");
      res.statusCode = 500;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ error: error.message }));
    }
  } else if (path === "/get-image" && method === "GET") {
    const query = searchParams.get("query");
    try {
      const response = await getJson({
        api_key: serpApiKey,
        engine: "google_images",
        q: query,
        google_domain: "google.com",
        hl: "en",
        gl: "us",
        device: "desktop",
      });

      res.statusCode = 200;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify(response));
    } catch (error) {
      console.log("ERROR");
      res.statusCode = 500;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ error: error.message }));
    }

  } else if (path === "/google-places-autocomplete" && method === "GET") {
    // Handle the request for Google Places Autocomplete for airports being entered into input fields
    const input = searchParams.get("input");
    const types = searchParams.get("types");

    if (!input) {
      res.statusCode = 400;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ error: "Missing 'input' parameter" }));
      return;
    }

    try {
      const response = await axios.get(
        `https://maps.googleapis.com/maps/api/place/autocomplete/json`,
        {
          params: {
            input,
            types,
            key: googleMapsKey,
          },
        }
      );

      res.statusCode = 200;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify(response.data));
    } catch (error) {
      res.statusCode = 500;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ error: error.message }));
    }
  } else if (path === "/google-places-details" && method === "GET") {
    // Handle the request for Google Places details to get lat/lng closest to trip center
    // or to get the city for an airport code
    const place_id = searchParams.get("place_id");
    const type = searchParams.get("type");
    if (!place_id) {
      res.statusCode = 400;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ error: "Missing 'place_id' parameter" }));
      return;
    }

    try {
      const response = await axios.get(
        `https://maps.googleapis.com/maps/api/place/details/json`,
        {
          params: {
            type,
            place_id,
            key: googleMapsKey,
          },
        }
      );

      res.statusCode = 200;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify(response.data));
    } catch (error) {
      res.statusCode = 500;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ error: error.message }));
    }
  } else if (path === "/google-places-nearby" && method === "GET") {
    // Handle the request for Google Places nearby for airports near to user computer
    const location = searchParams.get("location");
    const radius = searchParams.get("radius") || 50000;
    const type = "airport"

    if (!location) {
      res.statusCode = 400;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ error: "Missing 'location' parameter" }));
      return;
    }

    try {
      const response = await axios.get(
        `https://maps.googleapis.com/maps/api/place/nearbysearch/json`,
        {
          params: {
            location, 
            radius,
            type,
            key: googleMapsKey,
          },
        }
      );

      res.statusCode = 200;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify(response.data));
    } catch (error) {
      res.statusCode = 500;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ error: error.message }));
    }
  } else {
    res.statusCode = 404;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "Invalid route" }));
  } 
});

server.listen(port, '0.0.0.0', () => {
  console.log(`Server running at http://0.0.0.0:${port}/`);
});
